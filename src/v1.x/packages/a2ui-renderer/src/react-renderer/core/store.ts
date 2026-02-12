import type { Types } from '@a2ui/lit/0.8';
import type { OnActionCallback } from '../types';

/**
 * Stable actions that never change (won't cause re-renders).
 * These are stored in a ref and exposed via A2UIActionsContext.
 */
export interface A2UIActions {
  /** Process incoming server messages */
  processMessages: (messages: Types.ServerToClientMessage[]) => void;

  /** Update data in the data model (for two-way binding) */
  setData: (
    node: Types.AnyComponentNode | null,
    path: string,
    value: Types.DataValue,
    surfaceId: string
  ) => void;

  /** Dispatch a user action to the server */
  dispatch: (message: Types.A2UIClientEventMessage) => void;

  /** Clear all surfaces */
  clearSurfaces: () => void;

  /** Get a surface by ID */
  getSurface: (surfaceId: string) => Types.Surface | undefined;

  /** Get all surfaces */
  getSurfaces: () => ReadonlyMap<string, Types.Surface>;

  /** Get data from the data model */
  getData: (
    node: Types.AnyComponentNode,
    path: string,
    surfaceId: string
  ) => Types.DataValue | null;

  /** Resolve a relative path to an absolute path */
  resolvePath: (path: string, dataContextPath?: string) => string;
}

/**
 * The shape of the A2UI context value.
 * Combines stable actions with reactive state.
 */
export interface A2UIContextValue extends A2UIActions {
  /** The underlying message processor from @a2ui/lit */
  processor: Types.MessageProcessor;

  /** Version counter for triggering React re-renders */
  version: number;

  /** Callback for dispatching actions to the server */
  onAction: OnActionCallback | null;
}
