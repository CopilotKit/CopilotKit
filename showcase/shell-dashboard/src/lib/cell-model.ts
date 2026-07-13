/**
 * Thin re-export barrel — the canonical implementation now lives in the
 * harness at `showcase/harness/src/shared/cell-model/cell-model.ts` so BOTH the
 * dashboard and the harness monitor import ONE copy (zero duplication). The
 * dashboard consumes it via relative path across the package boundary — the
 * established precedent for this repo. This barrel keeps every existing
 * `@/lib/cell-model` / relative import site resolving unchanged.
 *
 * `export *` forwards every named value AND type export, including the
 * staleness windows this module originally re-exported (`E2E_STALE_AFTER_MS`,
 * `D4_STALE_AFTER_MS`, `LIVENESS_STALE_AFTER_MS`), plus `buildCellModel`,
 * `INFRA_ERROR_CLASSES`, and the type exports `TestStatus`, `ChipColor`,
 * `TestLevel`, `CellModel`, `CellModelInput`.
 */
export * from "../../../harness/src/shared/cell-model/cell-model";
