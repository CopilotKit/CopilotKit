import { useA2UIActions, useA2UIState } from "../core/A2UIProvider";

/**
 * Result returned by the useA2UI hook.
 */
export interface UseA2UIResult {
  /** Process incoming v0.9 A2UI messages */
  processMessages: (messages: Array<Record<string, unknown>>) => void;

  /** Get a surface model by ID */
  getSurface: (surfaceId: string) => any | undefined;

  /** Clear all surfaces */
  clearSurfaces: () => void;

  /** The current version number (increments on state changes) */
  version: number;
}

/**
 * Main API hook for A2UI v0.9. Provides methods to process messages
 * and access surface state.
 */
export function useA2UI(): UseA2UIResult {
  const actions = useA2UIActions();
  const state = useA2UIState();

  return {
    processMessages: actions.processMessages,
    getSurface: actions.getSurface,
    clearSurfaces: actions.clearSurfaces,
    version: state.version,
  };
}
