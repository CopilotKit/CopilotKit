/**
 * The content key that carries A2UI operations, on `a2ui-surface` activities
 * and on render tool results. Must match `A2UI_OPERATIONS_KEY` in
 * `@ag-ui/a2ui-middleware` and `copilotkit_runtime.a2ui` (Python).
 */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

/** The activity type the A2UI middleware streams surfaces and their lifecycle on. */
export const A2UI_SURFACE_ACTIVITY_TYPE = "a2ui-surface";

/** The tool the A2UI middleware injects so the model can generate a surface. */
export const RENDER_A2UI_TOOL_NAME = "render_a2ui";

/** The surface an operation that names no surface is filed under. */
export const A2UI_DEFAULT_SURFACE_ID = "default";

/**
 * The component id every renderer starts from when it walks a surface. A2UI
 * v0.9 gives a payload no way to name its own entry point, so it is fixed.
 * `@copilotkit/a2ui-renderer` exports the same value as `ROOT_COMPONENT_ID`.
 */
export const A2UI_ROOT_COMPONENT_ID = "root";
