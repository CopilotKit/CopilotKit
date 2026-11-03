/**
 * Framework-neutral A2UI engine: the parts of rendering A2UI that need
 * `@a2ui/web_core` but not React. React (through `@copilotkit/react-core`),
 * Vue and Angular all apply operations through it, so this module imports
 * nothing from React and loads through the
 * `@copilotkit/a2ui-renderer/engine` subpath.
 *
 * This entry does not import `@copilotkit/core`, so it can sit in an app's
 * initial bundle on its own. The helpers that need core (surface
 * diagnostics, tool-call snapshots) load from
 * `@copilotkit/a2ui-renderer/engine-core`. The web_core-free half (reading
 * operations, the action envelope, the lifecycle) lives in `@copilotkit/core`.
 *
 * Internal to CopilotKit: it can change in any release.
 */
export {
  normalizeA2UIOperations,
  applyA2UIOperations,
  A2UIOperationApplier,
} from "./engine/apply-operations";
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
