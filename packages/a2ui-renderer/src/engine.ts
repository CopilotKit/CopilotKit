/**
 * Framework-neutral A2UI engine: the parts of rendering A2UI that need
 * `@a2ui/web_core` but not React. React (through `@copilotkit/react-core`),
 * Vue and Angular all apply operations through it, so this module imports
 * nothing from React and loads through the
 * `@copilotkit/a2ui-renderer/engine` subpath.
 *
 * The web_core-free half (reading operations, the action envelope, the
 * diagnostics and the pre-paint lifecycle) lives in `@copilotkit/core`.
 *
 * Internal to CopilotKit: it can change in any release.
 */
export {
  normalizeA2UIOperations,
  applyA2UIOperations,
  A2UIOperationApplier,
} from "./engine/apply-operations";
export { A2UISurfaceDiagnostics } from "./engine/surface-diagnostics";
export type {
  A2UISurfaceDiagnosticsOptions,
  A2UISurfaceLookup,
} from "./engine/surface-diagnostics";
export {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  operationsFromA2UISnapshot as ɵoperationsFromA2UISnapshot,
  getRenderedA2UIToolOperations as ɵgetRenderedA2UIToolOperations,
} from "./engine/tool-operations";
export type { A2UIToolCallLike as ɵA2UIToolCallLike } from "./engine/tool-operations";
export {
  LEAF_MARGIN,
  CONTAINER_PADDING,
  STANDARD_BORDER,
  STANDARD_RADIUS,
  mapJustify,
  mapAlign,
  getBaseLeafStyle,
  getBaseContainerStyle,
  getDateTimeInputType,
} from "./basic-styles";
