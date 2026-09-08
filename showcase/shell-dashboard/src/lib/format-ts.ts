/**
 * Thin re-export barrel — the canonical implementation now lives in the
 * harness at `showcase/harness/src/shared/cell-model/format-ts.ts` so BOTH the
 * dashboard and the harness monitor import ONE copy (zero duplication). The
 * dashboard consumes it via relative path across the package boundary — the
 * established precedent for this repo (see e.g.
 * `d5-cadence-banner.redgreen.test.ts` importing `../../../harness/src/...`).
 * This barrel keeps every existing `@/lib/format-ts` / relative import site
 * resolving unchanged.
 */
export * from "../../../harness/src/shared/cell-model/format-ts";
