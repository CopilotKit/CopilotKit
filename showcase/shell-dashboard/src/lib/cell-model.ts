/** Shared cell model exports and the dashboard's fault boundary. */
export * from "../../../harness/src/shared/cell-model/cell-model";
export * from "../../../harness/src/shared/cell-model/catalog-input";

import { buildCellModel } from "../../../harness/src/shared/cell-model/cell-model";
import type {
  CellModel,
  CellModelInput,
} from "../../../harness/src/shared/cell-model/cell-model";
import type { LiveStatusMap } from "./live-status";

/** Dashboard boundary: a failed cell has no verdict and must not enter totals. */
export function tryBuildCellModel(
  live: LiveStatusMap,
  input: CellModelInput,
  now: number,
): CellModel | null {
  try {
    return buildCellModel(live, input, now);
  } catch (error) {
    console.error("Cell unavailable", input, error);
    return null;
  }
}
