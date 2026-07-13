/**
 * Thin re-export barrel — the canonical implementation now lives in the
 * harness at `showcase/harness/src/shared/cell-model/staleness.ts` so BOTH the
 * dashboard and the harness monitor import ONE copy (zero duplication). The
 * dashboard consumes it via relative path across the package boundary — the
 * established precedent for this repo. This barrel keeps every existing
 * `@/lib/staleness` / relative import site resolving unchanged.
 *
 * Forwards ALL originally-exported symbols: the value exports
 * `E2E_STALE_AFTER_MS`, `D4_STALE_AFTER_MS`, `LIVENESS_STALE_AFTER_MS`,
 * `STARTER_STALE_AFTER_MS`, and `isStale`.
 */
export * from "../../../harness/src/shared/cell-model/staleness";
