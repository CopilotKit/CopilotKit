/**
 * Pure per-cell projection for the `GET /api/matrix` read-model (spec §11).
 *
 * `computeMatrix` runs the ONE `buildCellModel` engine server-side over a set of
 * catalog cells and projects each `CellModel` to the semantic visual state the
 * chip renders. It has NO Hono/HTTP/PocketBase dependency — the route handler
 * (`matrix.ts`) merely reads PB rows, enumerates cells, calls this, and
 * serializes + gzips the result. Keeping it a standalone pure function is what
 * lets the dashboard-side `api == render == adapter` equivalence test (§11.4,
 * T14) import and exercise the EXACT computation the endpoint runs, without
 * importing the Hono route (finding 3).
 *
 * Because both the endpoint and the render path funnel through the SAME
 * `catalogCellToInput` (§5a) and the SAME `buildCellModel` (§2), the API output
 * equals the rendered chip by construction — there is no second derivation to
 * drift (§11.4).
 */
import {
  buildCellModel,
  type CellModel,
} from "../shared/cell-model/cell-model.js";
import {
  catalogCellToInput,
  type CellStructuralInput,
} from "../shared/cell-model/catalog-input.js";
import type { LiveStatusMap } from "../shared/cell-model/live-status.js";

/**
 * The per-cell semantic visual state (spec §11.3). Every field is a direct
 * projection of the cell's `CellModel` — the same values the chip, badges, and
 * stats render — so a consumer reads the TRUE chip state as JSON instead of
 * scraping the DOM.
 */
export interface MatrixCell {
  /** Integration/column slug the engine resolved this cell on. */
  slug: string;
  /** Catalog feature ID, or `null` for a liveness-only cell. */
  featureId: string | null;
  chipColor: CellModel["chipColor"];
  achievedDepth: CellModel["achievedDepth"];
  ceilingDepth: CellModel["ceilingDepth"];
  d6Effective: CellModel["d6Effective"];
  isRegression: boolean;
  surfaceState: CellModel["surfaceState"];
  isStaleCell: boolean;
  supported: boolean;
}

/**
 * Project one catalog cell to its `MatrixCell` visual state via the shared
 * `catalogCellToInput` → `buildCellModel` path (the render's exact pipeline).
 */
export function computeMatrixCell(
  live: LiveStatusMap,
  cell: CellStructuralInput,
  now: number,
): MatrixCell {
  const input = catalogCellToInput(cell);
  const m = buildCellModel(live, input, now);
  return {
    slug: input.slug,
    featureId: input.featureId,
    chipColor: m.chipColor,
    achievedDepth: m.achievedDepth,
    ceilingDepth: m.ceilingDepth,
    d6Effective: m.d6Effective,
    isRegression: m.isRegression,
    surfaceState: m.surfaceState,
    isStaleCell: m.isStaleCell,
    supported: m.supported,
  };
}

/**
 * A degraded gray/error `MatrixCell` for a cell whose model could not be built
 * (see `computeMatrix`). Mirrors the engine's own gray no-data singletons
 * (`UNSUPPORTED`/`NOT_WIRED_CELL`): floor depth, gray chip, no regression. The
 * `slug`/`featureId` are read straight off the raw structural cell (NOT via
 * `catalogCellToInput`, which itself could be the thing that threw), with the
 * SAME empty-string→null normalization the input mapping applies.
 */
function degradedCell(cell: CellStructuralInput): MatrixCell {
  return {
    slug: cell.integration,
    featureId: cell.feature === "" ? null : cell.feature,
    chipColor: "gray",
    achievedDepth: 0,
    ceilingDepth: 0,
    d6Effective: null,
    isRegression: false,
    surfaceState: "gray",
    isStaleCell: false,
    supported: cell.status !== "unsupported",
  };
}

/**
 * Compute the full matrix — one `MatrixCell` per catalog cell — off a single
 * `LiveStatusMap` and a fixed `now`. Pure and side-effect free.
 *
 * §E per-cell fault isolation: each cell is projected under its OWN try/catch.
 * The `""` featureId normalization upstream only neutralizes the empty string —
 * a featureId containing `:` or `/` still reaches `keyFor` (via `buildCellModel`)
 * and THROWS. Without a per-cell guard that one throw aborts the whole `.map`
 * and takes the ENTIRE surface to `matrix_unavailable`, defeating the "degrade
 * ONE cell, never the whole matrix" invariant. A throwing cell degrades to a
 * single gray cell and every sibling still computes. `onCellError` (optional,
 * so the pure equivalence test can call without it) lets the HTTP route log the
 * malformed cell loudly.
 */
export function computeMatrix(
  live: LiveStatusMap,
  cells: readonly CellStructuralInput[],
  now: number,
  onCellError?: (cell: CellStructuralInput, err: unknown) => void,
): MatrixCell[] {
  return cells.map((cell) => {
    try {
      return computeMatrixCell(live, cell, now);
    } catch (err) {
      onCellError?.(cell, err);
      return degradedCell(cell);
    }
  });
}
