/**
 * Runtime constants for the Lit renderer.
 *
 * `web-components` is built as its own unbundled entry into `dist/web-components`,
 * so it cannot reach back into `../a2ui-types.ts` without emitting outside that
 * output directory. The values here therefore mirror their React-side twins —
 * the same reason `surface.ts` keeps its own `DEFAULT_SURFACE_ID`.
 */

/**
 * The component id this renderer starts from when it walks a surface.
 * Mirrors `ROOT_COMPONENT_ID` in `../a2ui-types.ts`; keep the two in step.
 */
export const ROOT_COMPONENT_ID = "root";
