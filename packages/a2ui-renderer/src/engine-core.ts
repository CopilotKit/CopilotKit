/**
 * The A2UI engine helpers that use `@copilotkit/core`: development
 * diagnostics for applied surfaces, and the operations an A2UI tool call
 * renders. They are a separate entry from `@copilotkit/a2ui-renderer/engine`,
 * so loading the engine does not load core. A frontend that does not
 * already load core can import this entry on demand.
 *
 * Internal to CopilotKit: it can change in any release.
 */
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
