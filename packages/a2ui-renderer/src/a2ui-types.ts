/**
 * v0.9 A2UI type definitions for CopilotKit integration.
 */

/** Theme type - v0.9 themes are passed via createSurface message */
export type Theme = Record<string, unknown>;

/**
 * Client event message dispatched when a user interacts with an A2UI surface.
 * This is the format expected by A2UIMessageRenderer's handleAction.
 */
export interface A2UIClientEventMessage {
  userAction?: {
    name: string;
    surfaceId: string;
    sourceComponentId?: string;
    context?: Record<string, unknown>;
    timestamp?: string;
    dataContextPath?: string;
  };
}

/** Default surface ID when none is specified */
export const DEFAULT_SURFACE_ID = "default";

/**
 * The component id every renderer starts from when it walks a surface.
 *
 * A2UI v0.9 gives a payload no way to name its own entry point — `createSurface`
 * carries only `surfaceId`, `catalogId` and `theme` — so the id is fixed here
 * instead. A surface whose components do not include this id has nothing to
 * begin from and paints only the not-yet-arrived placeholder, which is why
 * `A2UIMessageRenderer` reports that state once operations have stopped.
 */
export const ROOT_COMPONENT_ID = "root";
