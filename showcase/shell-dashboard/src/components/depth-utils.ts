/**
 * `deriveDepth` — thin adapter over the ONE cell-model engine (spec §5).
 *
 * The independent D0–D6 ladder walk that used to live here has been deleted.
 * `deriveDepth` now projects `buildCellModel` (the single source of truth for
 * chip colour / achieved / ceiling / d6Effective / isRegression / staleness)
 * through the shared `catalogCellToInput` mapping, so the dashboard render path
 * and the engine can never diverge again:
 *
 *   const m = buildCellModel(live, catalogCellToInput(cell), now);
 *   return { achieved: m.achievedDepth, maxPossible: m.ceilingDepth,
 *            isRegression: m.isRegression, unsupported: !m.supported };
 *
 * `achievedDepth`/`ceilingDepth` are now `0-6` (they represent D1/D2 too, §B),
 * and the ceiling is STRUCTURAL (`computeMaxPossible` semantics, §4b), so the
 * projected `achieved`/`maxPossible` are drop-in for every consumer with no
 * loss of D1/D2 granularity. The old `isGreenAndFresh`/`isD4Green`/`isD5Green`/
 * `isD6Green`/`computeMaxPossible` helpers and the parallel walk are gone.
 *
 * The `CatalogCell` type is unified onto `@/data/catalog-types` (the superset
 * with `manifestation` + `parity_tier`) and re-exported here so existing
 * `@/components/depth-utils` import sites resolve unchanged. `catalog-types`
 * `CatalogCell` is structurally assignable to the engine's `CellStructuralInput`
 * (it carries `integration`/`feature`/`manifestation`/`status`/`parity_tier`),
 * so we pass the cell straight to `catalogCellToInput`.
 */
import { buildCellModel, catalogCellToInput } from "@/lib/cell-model";
import type { LiveStatusMap } from "@/lib/live-status";
import type { CatalogCell } from "@/data/catalog-types";

export type { CatalogCell };

/** Achieved depth on the D0-D6 ladder. */
export type AchievedDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DepthResult {
  /** Highest contiguous depth achieved (0-6). */
  achieved: AchievedDepth;
  /**
   * Maximum possible depth for this cell based on STRUCTURAL reachability
   * (`computeMaxPossible` semantics — whether a mapping/key exists at each
   * depth level, not whether it is currently green). Drives DepthChip relative
   * colouring: green when `achieved === maxPossible` (cell is at its ceiling).
   */
  maxPossible: AchievedDepth;
  /** Whether achieved depth is below maxPossible with a genuine failure above. */
  isRegression: boolean;
  /**
   * True when the cell's catalog status is "unsupported". Unsupported cells
   * never advance on the depth ladder — their `achieved` is always 0 and
   * `isRegression` is always false. Consumers should render the unsupported
   * indicator (e.g. the no-entry chip) instead of a numeric depth.
   */
  unsupported: boolean;
}

/**
 * Derive the achieved depth for a single catalog cell by projecting the ONE
 * engine. `catalogCellToInput` maps the cell's structural axes (slug /
 * featureId / manifestation / status) to the engine input; `buildCellModel`
 * owns every derivation. See the module header for the departures from the old
 * independent walk (D1/D2 now credited, ceiling structural, isRegression gated
 * on a genuine failure, staleness/first-strike/infra all engine-owned).
 */
export function deriveDepth(
  cell: CatalogCell,
  live: LiveStatusMap,
  now: number = Date.now(),
): DepthResult {
  const m = buildCellModel(live, catalogCellToInput(cell), now);
  return {
    achieved: m.achievedDepth,
    maxPossible: m.ceilingDepth,
    isRegression: m.isRegression,
    unsupported: !m.supported,
  };
}
