/**
 * page-stats — pure aggregate-stat computations for the AdaptiveStatsBar.
 *
 * Extracted from `app/page.tsx` so the aggregate functions are unit-testable
 * in isolation (mirrors the `computeColumnTally` pattern in feature-grid.tsx).
 * Every function here derives from the SAME `buildCellModel` / `resolveCell`
 * single source of truth that `renderCell` uses, so the stats bar agrees with
 * the matrix it summarizes.
 */

import { buildCellModel, catalogCellToInput } from "@/lib/cell-model";
import type { LiveStatusMap } from "@/lib/live-status";
import type { CatalogCell } from "@/data/catalog-types";
import type { ParityTier } from "@/components/parity-badge";
import type {
  DepthDistribution,
  D6Stats,
} from "@/components/adaptive-stats-bar";

/** Health rollup counts derived from `buildCellModel().chipColor`. */
export interface HealthStats {
  green: number;
  amber: number;
  red: number;
  /**
   * Cells with no actionable signal yet (`chipColor === "gray"`). Tracked
   * separately so a gray chip in the matrix is NOT folded into green in the
   * stats bar — the stats bar must mirror what the matrix shows.
   */
  noData: number;
}

/**
 * All ParityTier values, used to validate `cell.parity_tier` before indexing.
 * Exported so other consumers of raw `cell.parity_tier` (e.g. feature-grid's
 * `parityTierMap`) validate against the SAME set instead of an unchecked cast.
 */
export const PARITY_TIERS: ReadonlySet<ParityTier> = new Set<ParityTier>([
  "reference",
  "at_parity",
  "partial",
  "minimal",
  "not_wired",
]);

/**
 * Validate a raw `cell.parity_tier` against the known `ParityTier` set,
 * returning the narrowed tier or `undefined` for an unknown/corrupt value.
 * Centralizes the guard so callers don't `as ParityTier`-cast blindly.
 */
export function asParityTier(tier: unknown): ParityTier | undefined {
  return PARITY_TIERS.has(tier as ParityTier)
    ? (tier as ParityTier)
    : undefined;
}

/**
 * Exhaustive achievedDepth → DepthDistribution key map. The compiler enforces
 * completeness: `buildCellModel().achievedDepth` is now typed `0-6` (the engine
 * widened to represent D1/D2 liveness, §B), so every reachable depth MUST have
 * an entry or this fails to type-check. Replaces the unchecked
 * `` `d${depth}` as keyof `` cast that silently produced a `"d6"` key the type
 * lacked, dropping D6 cells. D1/D2 (liveness-only, e2e not yet green) land in
 * the `d0` "below-D3-verification" bucket — the distribution tracks D3+ parity
 * depth, so a cell that has not reached D3 counts with the D0 tier.
 */
const DEPTH_TO_KEY: Record<0 | 1 | 2 | 3 | 4 | 5 | 6, keyof DepthDistribution> =
  {
    0: "d0",
    1: "d0",
    2: "d0",
    3: "d3",
    4: "d4",
    5: "d5",
    6: "d6",
  };

/**
 * Health stats across all wired (or stub) cells, derived from
 * `buildCellModel().chipColor`.
 *
 * The engine input is built via the ONE shared `catalogCellToInput` mapping
 * (spec §5a) — the SAME mapping the matrix render path (`deriveDepth`) and the
 * harness `/api/matrix` read-model use. Hand-constructing `{ isSupported: true,
 * isWired: true }` here (the previous approach) omitted `probeAxis`, which
 * silently mis-resolved a starter cell on the agent feature ladder instead of
 * the `starter_smoke` matrix — routing through `catalogCellToInput` makes that
 * divergence structurally impossible instead of relying on the (currently
 * true, but unstated) invariant that no starter cell reaches this loop.
 *
 * A `status === "stub"` cell is included (not skipped): the engine treats a
 * stub as wired-but-not-built (`catalogCellToInput`'s `isWired` covers
 * `"wired" | "stub"`), and the matrix renders a real chip for it, so excluding
 * it here would make the stats bar undercount what the matrix shows. A stub
 * with no live data resolves to a gray chip → counted as `noData`.
 *
 * A gray chip (no data yet) is counted as `noData`, NOT green: the matrix shows
 * gray, so folding it into green would make the stats bar disagree with the
 * matrix it summarizes.
 *
 * NO DEDUP (unlike `computeParityStats`/docsStats): `catalogData.cells` is
 * one row per grid cell — an `(integration, feature)` pair is unique across the
 * catalog (verified: 0 duplicate pairs). Health is a PER-CELL signal, so every
 * wired/stub cell is counted exactly once. `computeParityStats` dedups by
 * `integration` because parity is per-integration (many cells share one slug),
 * and docsStats dedups by `feature` because docs are per-feature; neither
 * applies to a genuinely per-cell rollup.
 */
export function computeHealthStats(
  cells: readonly CatalogCell[],
  liveStatus: LiveStatusMap,
  now: number,
): HealthStats {
  let green = 0;
  let amber = 0;
  let red = 0;
  let noData = 0;
  for (const cell of cells) {
    if (
      (cell.status !== "wired" && cell.status !== "stub") ||
      cell.feature === null
    )
      continue;
    const model = buildCellModel(liveStatus, catalogCellToInput(cell), now);
    switch (model.chipColor) {
      case "green":
        green++;
        break;
      case "amber":
        amber++;
        break;
      case "red":
        red++;
        break;
      case "gray":
        noData++;
        break;
    }
  }
  return { green, amber, red, noData };
}

/**
 * Parity-tier counts across unique integrations.
 *
 * `cell.parity_tier` is validated against the known `ParityTier` set before
 * indexing — an unknown tier (corrupt/forward-incompatible catalog data) is
 * skipped rather than producing `counts[undefined]++ === NaN`. Logged loudly so
 * the bad data surfaces instead of silently corrupting the bar.
 */
export function computeParityStats(
  cells: readonly CatalogCell[],
): Record<ParityTier, number> {
  const counts: Record<ParityTier, number> = {
    reference: 0,
    at_parity: 0,
    partial: 0,
    minimal: 0,
    not_wired: 0,
  };
  const seen = new Set<string>();
  for (const cell of cells) {
    if (seen.has(cell.integration)) continue;
    seen.add(cell.integration);
    const tier = cell.parity_tier;
    if (!PARITY_TIERS.has(tier as ParityTier)) {
      // Fail-loud on unknown tier — skip the count rather than indexing with
      // an undefined key (which yields NaN and poisons every downstream sum).
      console.error(
        `computeParityStats: unknown parity_tier ${JSON.stringify(
          tier,
        )} for integration ${JSON.stringify(cell.integration)} — skipping`,
      );
      continue;
    }
    counts[tier as ParityTier]++;
  }
  return counts;
}

/**
 * Depth distribution across all wired (or stub) cells, keyed by achieved depth.
 *
 * Uses the exhaustive `DEPTH_TO_KEY` map instead of a string cast so D6-achieved
 * cells land in the `d6` bucket (the previous `` `d${depth}` as keyof `` cast
 * produced a `"d6"` key the type lacked → `dist["d6"]++ === NaN`, dropping every
 * D6 cell). The engine input is built via the shared `catalogCellToInput`
 * mapping and a stub is included in the loop — see `computeHealthStats` for
 * why both of those match the matrix render path.
 */
export function computeDepthDistribution(
  cells: readonly CatalogCell[],
  liveStatus: LiveStatusMap,
  now: number,
): DepthDistribution {
  const dist: DepthDistribution = {
    d6: 0,
    d5: 0,
    d4: 0,
    d3: 0,
    d0: 0,
  };
  for (const cell of cells) {
    if (
      (cell.status !== "wired" && cell.status !== "stub") ||
      cell.feature === null
    )
      continue;
    const model = buildCellModel(liveStatus, catalogCellToInput(cell), now);
    const key = DEPTH_TO_KEY[model.achievedDepth];
    dist[key]++;
  }
  return dist;
}

/**
 * D6 (parity-vs-reference) rollup counts across wired cells.
 *
 * Counts the LADDER-GATED D6 status (`buildCellModel().d6Effective`), NOT the
 * raw per-dimension D6 tone (`resolveCell().d6.tone`). D6 is the top of the
 * verification ladder, so a cell only counts as D6-green when the ladder through
 * D5 is intact (full ladder → `d6Effective === "green"` → `chipColor === "green"`
 * → `achievedDepth === 6`). A cell whose D5 is broken/unverified — which a raw
 * green D6 row would otherwise overstate as "D6 green" — collapses to `null`
 * (blocked) and is counted as `gray`, NOT green. This makes the headline D6
 * count agree with the matrix's per-cell D6 badge (which renders the same
 * `d6Effective`) and the chip; the standalone 1P/API/BE badges still show the
 * raw per-dimension failure.
 *
 * Buckets stay coherent with the badge tone mapping:
 *   d6Effective green → green
 *   d6Effective red   → red    (genuine D6 failure, ladder intact through D5)
 *   d6Effective amber → degraded (stale/degraded D6, ladder intact through D5)
 *   d6Effective null  → gray   (no row, OR blocked by a broken/unverified ladder)
 *
 * Includes stub cells (see `computeHealthStats`) — a stub's engine input is
 * `isWired: true` with no live rows, so it lands in `gray` here.
 */
export function computeD6Stats(
  cells: readonly CatalogCell[],
  liveStatus: LiveStatusMap,
  now: number,
): D6Stats {
  let green = 0;
  let degraded = 0;
  let gray = 0;
  let red = 0;
  for (const cell of cells) {
    if (
      (cell.status !== "wired" && cell.status !== "stub") ||
      cell.feature === null
    )
      continue;
    const model = buildCellModel(liveStatus, catalogCellToInput(cell), now);
    switch (model.d6Effective) {
      case "green":
        green++;
        break;
      case "red":
        red++;
        break;
      case "amber":
        degraded++;
        break;
      default:
        // null — no row OR blocked by a broken/unverified ladder below D6.
        gray++;
        break;
    }
  }
  return { green, degraded, gray, red };
}
