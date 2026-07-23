/**
 * Thin re-export barrel — the canonical implementation now lives in the
 * harness at `showcase/harness/src/shared/cell-model/cell-model.ts` so BOTH the
 * dashboard and the harness monitor import ONE copy (zero duplication). The
 * dashboard consumes it via relative path across the package boundary — the
 * established precedent for this repo. This barrel keeps every existing
 * `@/lib/cell-model` / relative import site resolving unchanged.
 *
 * `export *` forwards every named value AND type export from the canonical
 * module unchanged, so existing import sites resolve identically.
 */
export * from "../../../harness/src/shared/cell-model/cell-model";
// The shared catalog→input mapping (spec §5a) — forwarded so the dashboard
// adapter (T11) and any consumer import the ONE function from the barrel.
export * from "../../../harness/src/shared/cell-model/catalog-input";
