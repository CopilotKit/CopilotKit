/**
 * Thin re-export barrel — the canonical glyph vocabulary lives in the harness
 * at `showcase/harness/src/shared/cell-model/glyphs.ts` so BOTH the dashboard
 * renderer/legend and the harness label builders import ONE copy. Same
 * precedent as `@/lib/live-status`.
 */
export * from "../../../harness/src/shared/cell-model/glyphs";
