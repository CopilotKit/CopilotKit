/**
 * page-stats — pure aggregate-stat computations for the AdaptiveStatsBar.
 *
 * Extracted from `app/page.tsx` so the aggregate functions are unit-testable
 * in isolation (mirrors the `computeColumnTally` pattern in feature-grid.tsx).
 * Every function here derives from the SAME `buildCellModel` / `resolveCell`
 * single source of truth that `renderCell` uses, so the stats bar agrees with
 * the matrix it summarizes.
 */

import { buildCellModel } from "@/lib/cell-model";
import { resolveCell } from "@/lib/live-status";
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

/** All ParityTier values, used to validate `cell.parity_tier` before indexing. */
const PARITY_TIERS: ReadonlySet<ParityTier> = new Set<ParityTier>([
  "reference",
  "at_parity",
  "partial",
  "minimal",
  "not_wired",
]);

/**
 * Exhaustive achievedDepth → DepthDistribution key map. The compiler enforces
 * completeness: `buildCellModel().achievedDepth` is typed `0 | 3 | 4 | 5 | 6`,
 * so every reachable depth (including D6) MUST have an entry or this fails to
 * type-check. Replaces the unchecked `` `d${depth}` as keyof `` cast that
 * silently produced a `"d6"` key the type lacked, dropping D6 cells.
 */
const DEPTH_TO_KEY: Record<0 | 3 | 4 | 5 | 6, keyof DepthDistribution> = {
  0: "d0",
  3: "d3",
  4: "d4",
  5: "d5",
  6: "d6",
};

/**
 * Health stats across all wired cells, derived from `buildCellModel().chipColor`.
 *
 * `isSupported: true` is correct by construction: `generate-registry.ts`
 * resolves a feature listed in `not_supported_features` to catalog status
 * `"unsupported"` BEFORE the `"wired"` branch, so a `status === "wired"` cell
 * can never also be unsupported. The matrix's `renderCell` derives support from
 * `not_supported_features`, but for wired cells that always yields supported —
 * the two agree, so passing `true` here keeps the stats bar consistent with the
 * matrix. See `determineCellStatus` in scripts/generate-registry.ts.
 *
 * A gray chip (no data yet) is counted as `noData`, NOT green: the matrix shows
 * gray, so folding it into green would make the stats bar disagree with the
 * matrix it summarizes.
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
    if (cell.status !== "wired" || cell.feature === null) continue;
    const model = buildCellModel(
      liveStatus,
      {
        slug: cell.integration,
        featureId: cell.feature,
        isSupported: true,
        isWired: true,
      },
      now,
    );
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
 * Depth distribution across all wired cells, keyed by achieved depth.
 *
 * Uses the exhaustive `DEPTH_TO_KEY` map instead of a string cast so D6-achieved
 * cells land in the `d6` bucket (the previous `` `d${depth}` as keyof `` cast
 * produced a `"d6"` key the type lacked → `dist["d6"]++ === NaN`, dropping every
 * D6 cell). `isSupported: true` is correct by construction — see
 * `computeHealthStats`.
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
    d2: 0,
    d1: 0,
    d0: 0,
  };
  for (const cell of cells) {
    if (cell.status !== "wired" || cell.feature === null) continue;
    const model = buildCellModel(
      liveStatus,
      {
        slug: cell.integration,
        featureId: cell.feature,
        isSupported: true,
        isWired: true,
      },
      now,
    );
    const key = DEPTH_TO_KEY[model.achievedDepth];
    dist[key]++;
  }
  return dist;
}

/**
 * D6 (parity-vs-reference) rollup counts across wired cells.
 *
 * The D6 badge tone (`resolveCell().d6.tone`) is one of green / red / amber
 * (degraded or stale-green) / gray (no row). Amber is counted as `degraded` and
 * surfaced distinctly — folding it into gray (the previous `default` branch)
 * hid stale/degraded D6 as "no data". This matches how the matrix and staleness
 * machinery treat a degraded D6 badge.
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
    if (cell.status !== "wired" || cell.feature === null) continue;
    const state = resolveCell(liveStatus, cell.integration, cell.feature, {
      now,
    });
    switch (state.d6.tone) {
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
        // gray (no row) — distinct from degraded.
        gray++;
        break;
    }
  }
  return { green, degraded, gray, red };
}
