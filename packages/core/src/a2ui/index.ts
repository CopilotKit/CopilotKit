/**
 * A2UI logic that React, Vue and Angular share: reading operations, the
 * action envelope, development diagnostics and the pre-paint lifecycle.
 * Nothing here depends on `@a2ui/web_core`; the parts that do live in
 * `@copilotkit/a2ui-renderer/engine`.
 *
 * Names that start with `ɵ` are internal: the framework packages use them,
 * and they can change in any release.
 */

export {
  A2UI_OPERATIONS_KEY as ɵA2UI_OPERATIONS_KEY,
  A2UI_SURFACE_ACTIVITY_TYPE as ɵA2UI_SURFACE_ACTIVITY_TYPE,
  RENDER_A2UI_TOOL_NAME as ɵRENDER_A2UI_TOOL_NAME,
  A2UI_DEFAULT_SURFACE_ID as ɵA2UI_DEFAULT_SURFACE_ID,
  A2UI_ROOT_COMPONENT_ID as ɵA2UI_ROOT_COMPONENT_ID,
} from "./constants";

export {
  getA2UIOperations as ɵgetA2UIOperations,
  getA2UIOperationSurfaceId as ɵgetA2UIOperationSurfaceId,
  groupA2UIOperationsBySurface as ɵgroupA2UIOperationsBySurface,
  surfaceHasRenderableContent as ɵsurfaceHasRenderableContent,
} from "./operations";
export type { A2UIOperation as ɵA2UIOperation } from "./operations";

export {
  A2UI_PAINT_FALLBACK_MS as ɵA2UI_PAINT_FALLBACK_MS,
  diagnoseUnpaintedSurface as ɵdiagnoseUnpaintedSurface,
  diagnoseMissingSurface as ɵdiagnoseMissingSurface,
  diagnoseUnresolvedRoot as ɵdiagnoseUnresolvedRoot,
} from "./diagnostics";
export type { A2UIDiagnosedSurface as ɵA2UIDiagnosedSurface } from "./diagnostics";

export {
  toA2UIClientEvent as ɵtoA2UIClientEvent,
  runA2UIAction as ɵrunA2UIAction,
} from "./actions";
export type {
  A2UIUserAction as ɵA2UIUserAction,
  A2UIClientEvent as ɵA2UIClientEvent,
  A2UIActionInterceptor as ɵA2UIActionInterceptor,
  A2UIProcessorAction as ɵA2UIProcessorAction,
  A2UIActionCore as ɵA2UIActionCore,
  A2UIActionAgent as ɵA2UIActionAgent,
} from "./actions";

export {
  readA2UILifecycle as ɵreadA2UILifecycle,
  resolveA2UIDebugExposure as ɵresolveA2UIDebugExposure,
  getA2UIProgressPhase as ɵgetA2UIProgressPhase,
  formatA2UIRetryLabel as ɵformatA2UIRetryLabel,
  formatA2UIDebugPayload as ɵformatA2UIDebugPayload,
  A2UI_RECOVERY_DEFAULTS as ɵA2UI_RECOVERY_DEFAULTS,
  A2UI_LIFECYCLE_TEXT as ɵA2UI_LIFECYCLE_TEXT,
  A2UI_SKELETON_ROWS as ɵA2UI_SKELETON_ROWS,
  A2UIActivityController as ɵA2UIActivityController,
  A2UI_SURFACE_CONTENT_SCHEMA as ɵA2UI_SURFACE_CONTENT_SCHEMA,
} from "./lifecycle";
export type {
  A2UIDebugExposure as ɵA2UIDebugExposure,
  A2UILifecycleStatus as ɵA2UILifecycleStatus,
  A2UILifecycle as ɵA2UILifecycle,
  A2UIRecoveryOptions as ɵA2UIRecoveryOptions,
  A2UIProgressPhase as ɵA2UIProgressPhase,
  A2UISkeletonBar as ɵA2UISkeletonBar,
  A2UISkeletonPart as ɵA2UISkeletonPart,
  A2UIActivityView as ɵA2UIActivityView,
  A2UIActivitySnapshot as ɵA2UIActivitySnapshot,
  A2UIScheduler as ɵA2UIScheduler,
  A2UIActivityControllerOptions as ɵA2UIActivityControllerOptions,
  A2UISurfaceContent as ɵA2UISurfaceContent,
} from "./lifecycle";
