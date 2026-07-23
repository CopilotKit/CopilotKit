/**
 * Thin re-export barrel — the canonical implementation now lives in the
 * harness at `showcase/harness/src/shared/cell-model/live-status.ts` so BOTH
 * the dashboard and the harness monitor import ONE copy (zero duplication). The
 * dashboard consumes it via relative path across the package boundary — the
 * established precedent for this repo. This barrel keeps every existing
 * `@/lib/live-status` / relative import site resolving unchanged.
 *
 * `export *` forwards every named value AND type export from the canonical
 * module unchanged, so existing import sites resolve identically.
 */
export * from "../../../harness/src/shared/cell-model/live-status";
