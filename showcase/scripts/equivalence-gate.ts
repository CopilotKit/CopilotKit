/**
 * Prod ↔ Staging equivalence gate (UNIT U9, spec §6.3/§6.4).
 *
 * After a cluster promote re-pins prod and a fresh prod re-sweep lands (U10),
 * this gate decides whether prod is "equivalent enough" to staging to call the
 * promote a success. It does NOT re-implement any colour derivation — it reuses
 * the dashboard's `buildCellModel` (the SINGLE source of truth for the
 * presentation `ChipColor`) against BOTH PocketBase instances and compares on
 * the resolved `ChipColor` (green | amber | red | gray), never the lower-level
 * `State`.
 *
 * ── OQ-5 decision: IMPORT, not mirror ────────────────────────────────────
 * `showcase/shell-dashboard` is intentionally OUTSIDE the pnpm workspace (npm),
 * while `showcase/scripts` is in it. But ChipColor derivation must have ONE
 * source of truth — duplicating `buildCellModel`'s ~300-line ladder/U7/U8 logic
 * here would be a guaranteed-to-drift second copy of the very thing the gate
 * exists to honor. So we import it by RELATIVE PATH
 * (`../shell-dashboard/src/lib/cell-model`). This is the lower-blast option and
 * is already an established pattern in this directory:
 * `redirect-decommission-core.test.ts` imports `../shell/src/lib/seo-redirects`
 * the same way. The dashboard lib subtree we pull in
 * (`cell-model → live-status → staleness → format-ts`) has ZERO React/Next/`@/`
 * dependencies — it is a pure-TS subtree — so the import resolves cleanly under
 * tsx / vitest / tsc (`moduleResolution: bundler`, extensionless) without
 * dragging the dashboard into the pnpm graph or the gate into npm. tsc on
 * `scripts/tsconfig.json` (`include: ["*.ts", …]`) follows the relative import
 * and typechecks the subtree with `skipLibCheck`. No tsconfig `paths` mapping
 * and no mirror+parity-test were needed.
 *
 * ── Gate rules (spec §6.3) ────────────────────────────────────────────────
 *   - FAIL only on a cell that is `green` on STAGING and NOT-`green` on PROD,
 *     EXCLUDING any cell `gray` on EITHER side. Driver-error / abort (U7) and
 *     stale rows (U8 / §6.4) fold to `gray`, so they drop out — this is what
 *     fixes the 418-false-fail.
 *   - ONE-DIRECTIONAL (§1.1): prod GREENER than staging PASSES (the ~81-vs-~99
 *     asymmetry is the point, not a defect). We only flag staging-green →
 *     prod-not-green regressions.
 *   - `amber` = not-green (a staging-green / prod-amber cell IS a mismatch).
 *
 * ── Freshness (spec §6.4) ─────────────────────────────────────────────────
 * `buildCellModel`'s U8 stale-fold uses each row family's staleness WINDOW
 * relative to `now`. The gate needs a STRICTER, promote-scoped freshness: ANY
 * prod cell whose newest contributing row predates the RE-SWEEP TRIGGER instant
 * is treated as gray/excluded — a row from before the re-sweep is not evidence
 * about the just-promoted prod, regardless of whether it is within its family
 * window. So we additionally exclude a prod cell when none of its contributing
 * rows was observed at/after `reSweepTriggerAt`. (Staging is NOT held to the
 * re-sweep freshness — only prod was just re-swept.)
 */

import { buildCellModel } from "../shell-dashboard/src/lib/cell-model";
import type {
  ChipColor,
  CellModelInput,
} from "../shell-dashboard/src/lib/cell-model";
import {
  keyFor,
  CATALOG_TO_D5_KEY,
  STARTER_LEVELS,
} from "../shell-dashboard/src/lib/live-status";
import type { LiveStatusMap } from "../shell-dashboard/src/lib/live-status";

/** A single (integration, feature) cell to compare across envs. */
export type GateCell = CellModelInput;

/** Why a cell was excluded from the gate verdict. */
export type ExclusionReason =
  /** The cell is `gray` on staging (no green claim to honor). */
  | "gray-staging"
  /** The cell folded to `gray` on prod (driver-error / abort / U8 stale). */
  | "gray-prod"
  /** Every prod row for the cell predates the re-sweep trigger (§6.4). */
  | "stale-prod"
  /** The cell is unsupported / not-wired (no comparable verification). */
  | "unsupported";

export interface CellComparison {
  slug: string;
  featureId: string;
  /** Resolved staging ChipColor (`buildCellModel`). */
  stagingChip: ChipColor;
  /**
   * Resolved prod ChipColor, AFTER the §6.4 re-sweep-freshness fold (a
   * pre-trigger prod cell reads `gray` here even if `buildCellModel` would
   * have rendered another colour).
   */
  prodChip: ChipColor;
  /** True when the cell does not count toward the gate verdict. */
  excluded: boolean;
  /** Populated iff `excluded` — the dominant reason. */
  excludedReason?: ExclusionReason;
  /**
   * True when this cell is a GATE MISMATCH (staging-green, prod-not-green,
   * neither side gray, fresh prod). A mismatch fails the gate.
   */
  mismatch: boolean;
}

export interface EquivalenceGateInput {
  /** The cells to compare. The caller (U10) enumerates the promoted closure. */
  cells: GateCell[];
  /** Status rows read from the STAGING PocketBase. */
  stagingRows: LiveStatusMap;
  /** Status rows read from the PROD PocketBase. */
  prodRows: LiveStatusMap;
  /**
   * Epoch ms of the re-sweep trigger. A prod cell whose newest contributing
   * row predates this instant is excluded as stale (§6.4).
   */
  reSweepTriggerAt: number;
  /** `now` for the underlying `buildCellModel` staleness folds. Defaults to `Date.now()`. */
  now?: number;
}

export interface EquivalenceGateResult {
  /** True when no cell is a mismatch (the promote is equivalence-clean). */
  passed: boolean;
  /** Every cell's comparison, in input order. */
  comparisons: CellComparison[];
  /** Just the mismatching cells (the gate-failing subset), in input order. */
  mismatches: CellComparison[];
  /** A human-readable summary for `$GITHUB_STEP_SUMMARY` + Slack. */
  summary: string;
}

/**
 * The maximum prod-row `observed_at`, in epoch ms, across EVERY row a cell
 * derives from — or `null` when the cell has no contributing rows (no-data;
 * nothing to date). Mirrors the keyspace `buildCellModel`'s resolvers and
 * `computeCellFreshness` fan out over (e2e, chat/tools, the D5/D6 per-cell
 * family, health) so the gate's freshness verdict cannot diverge from what the
 * chip was derived from. An unparseable `observed_at` cannot establish recency
 * and is skipped (it can never beat the trigger), failing safe toward
 * "excluded as stale".
 */
function newestProdObservation(
  rows: LiveStatusMap,
  cell: GateCell,
): number | null {
  const { slug, featureId } = cell;
  // STARTER axis: a starter cell derives ONLY from its `starter:<col>/<level>`
  // rows (`buildCellModel`'s `resolveStarterChip` reads exactly these), so its
  // §6.4 freshness must be dated off the SAME keys — NOT the agent
  // e2e/chat/tools/health + d5/d6 keyspace, which a starter never writes.
  const keys: string[] =
    cell.probeAxis === "starter"
      ? STARTER_LEVELS.map((level) => keyFor("starter", slug, level))
      : [
          keyFor("e2e", slug, featureId),
          keyFor("chat", slug),
          keyFor("tools", slug),
          keyFor("health", slug),
        ];
  if (cell.probeAxis !== "starter") {
    const familyKeys = CATALOG_TO_D5_KEY[featureId];
    if (familyKeys) {
      for (const ft of familyKeys) {
        keys.push(keyFor("d5", slug, ft));
        keys.push(keyFor("d6", slug, ft));
      }
    }
  }

  let newest: number | null = null;
  for (const key of keys) {
    const row = rows.get(key);
    if (!row) continue;
    const observedMs = Date.parse(row.observed_at);
    if (Number.isNaN(observedMs)) continue;
    if (newest === null || observedMs > newest) newest = observedMs;
  }
  return newest;
}

/**
 * Compare one cell across envs and produce its `CellComparison`.
 *
 * Exclusion precedence (a cell can satisfy several at once — we record the
 * FIRST that applies, but any one is enough to exclude):
 *   1. unsupported / not-wired      — no comparable verification on either env.
 *   2. gray on staging              — no green claim to honor (gate fires only
 *                                     on staging-green).
 *   3. stale prod (§6.4)            — every prod row predates the re-sweep.
 *   4. gray on prod (U7/U8)         — driver-error/abort/stale → not a product
 *                                     red.
 * A cell is a MISMATCH only when it is NOT excluded, staging is `green`, and
 * prod is not `green`.
 */
function compareCell(
  input: EquivalenceGateInput,
  cell: GateCell,
  now: number,
): CellComparison {
  const staging = buildCellModel(input.stagingRows, cell, now);
  const prodModel = buildCellModel(input.prodRows, cell, now);

  const stagingChip = staging.chipColor;

  // §6.4 re-sweep freshness: a prod cell with contributing rows but NONE at or
  // after the trigger is stale-excluded → its effective prod chip is gray.
  const newestProd = newestProdObservation(input.prodRows, cell);
  const prodIsStaleForGate =
    newestProd !== null && newestProd < input.reSweepTriggerAt;
  const prodChip: ChipColor = prodIsStaleForGate ? "gray" : prodModel.chipColor;

  let excluded = false;
  let excludedReason: ExclusionReason | undefined;

  if (!cell.isSupported || !cell.isWired) {
    excluded = true;
    excludedReason = "unsupported";
  } else if (stagingChip === "gray") {
    excluded = true;
    excludedReason = "gray-staging";
  } else if (prodIsStaleForGate) {
    excluded = true;
    excludedReason = "stale-prod";
  } else if (prodChip === "gray") {
    excluded = true;
    excludedReason = "gray-prod";
  }

  const mismatch = !excluded && stagingChip === "green" && prodChip !== "green";

  return {
    slug: cell.slug,
    featureId: cell.featureId,
    stagingChip,
    prodChip,
    excluded,
    ...(excludedReason ? { excludedReason } : {}),
    mismatch,
  };
}

/** Build the workflow-summary / Slack text for a result. */
function buildSummary(
  comparisons: CellComparison[],
  mismatches: CellComparison[],
): string {
  const total = comparisons.length;
  const excluded = comparisons.filter((c) => c.excluded).length;
  const compared = total - excluded;
  if (mismatches.length === 0) {
    return (
      `Equivalence gate PASSED — ${compared} compared, ${excluded} excluded ` +
      `(gray/stale/unsupported), 0 prod regressions across ${total} cells.`
    );
  }
  const lines = mismatches
    .map(
      (m) =>
        `  - ${m.slug}/${m.featureId}: staging=${m.stagingChip} prod=${m.prodChip}`,
    )
    .join("\n");
  return (
    `Equivalence gate FAILED — ${mismatches.length} prod regression(s) ` +
    `(staging green, prod not green) of ${compared} compared ` +
    `(${excluded} excluded):\n${lines}`
  );
}

/**
 * Run the prod ↔ staging equivalence gate over `cells`. Pure: no I/O, no
 * mutation of the input maps. The caller reads both PocketBase instances and
 * supplies the rows + cell list.
 */
export function runEquivalenceGate(
  input: EquivalenceGateInput,
): EquivalenceGateResult {
  const now = input.now ?? Date.now();
  const comparisons = input.cells.map((cell) => compareCell(input, cell, now));
  const mismatches = comparisons.filter((c) => c.mismatch);
  return {
    passed: mismatches.length === 0,
    comparisons,
    mismatches,
    summary: buildSummary(comparisons, mismatches),
  };
}
