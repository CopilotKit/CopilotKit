import type { OnActionCallback } from "../types";

/**
 * Stable actions that never change (won't cause re-renders).
 * These are stored in a ref and exposed via A2UIActionsContext.
 */
export interface A2UIActions {
  /** Process incoming v0.9 A2UI messages */
  processMessages: (messages: Array<Record<string, unknown>>) => void;

  /** Dispatch a user action to the server */
  dispatch: (message: any) => void;

  /** Get a surface model by ID */
  getSurface: (surfaceId: string) => any | undefined;

  /** Clear all surfaces (creates a new processor) */
  clearSurfaces: () => void;
}

/**
 * The shape of the A2UI context value.
 * Combines stable actions with reactive state.
 */
export interface A2UIContextValue extends A2UIActions {
  /** Version counter for triggering React re-renders */
  version: number;

  /** Callback for dispatching actions to the server */
  onAction: OnActionCallback | null;
}
