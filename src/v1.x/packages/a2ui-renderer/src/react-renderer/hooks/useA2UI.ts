import type { Types } from '@a2ui/lit/0.8';
import { useA2UIActions, useA2UIState } from '../core/A2UIProvider';

/**
 * Result returned by the useA2UI hook.
 */
export interface UseA2UIResult {
  /** Process incoming server messages */
  processMessages: (messages: Types.ServerToClientMessage[]) => void;

  /** Get a surface by ID */
  getSurface: (surfaceId: string) => Types.Surface | undefined;

  /** Get all surfaces */
  getSurfaces: () => ReadonlyMap<string, Types.Surface>;

  /** Clear all surfaces */
  clearSurfaces: () => void;

  /** The current version number (increments on state changes) */
  version: number;
}

/**
 * Main API hook for A2UI. Provides methods to process messages
 * and access surface state.
 *
 * Note: This hook subscribes to state changes. Components using this
 * will re-render when the A2UI state changes. For action-only usage
 * (no re-renders), use useA2UIActions() instead.
 *
 * @returns Object with message processing and surface access methods
 *
 * @example
 * ```tsx
 * function ChatApp() {
 *   const { processMessages, getSurface } = useA2UI();
 *
 *   useEffect(() => {
 *     const ws = new WebSocket('wss://agent.example.com');
 *     ws.onmessage = (event) => {
 *       const messages = JSON.parse(event.data);
 *       processMessages(messages);
 *     };
 *     return () => ws.close();
 *   }, [processMessages]);
 *
 *   return <A2UIRenderer surfaceId="main" />;
 * }
 * ```
 */
export function useA2UI(): UseA2UIResult {
  const actions = useA2UIActions();
  const state = useA2UIState();

  return {
    processMessages: actions.processMessages,
    getSurface: actions.getSurface,
    getSurfaces: actions.getSurfaces,
    clearSurfaces: actions.clearSurfaces,
    version: state.version,
  };
}
