import { useEffect, useRef } from "react";
import type {
  A2UIUserAction,
  A2UIDeclaredOps,
  A2UIOps,
} from "../a2ui/A2UIMessageRenderer";
import { useA2UIActionHandlerRegistry } from "../providers/A2UIActionHandlerRegistry";

/**
 * A registered A2UI action handler.
 */
export interface A2UIActionHandlerRegistration {
  /** The action name to match (e.g., "book_flight"). */
  actionName: string;
  /**
   * Handler called when the action is dispatched.
   *
   * @param action - The dispatched user action with context and dataContextPath.
   * @param declaredOps - Pre-declared A2UI operations for this action from the
   *   agent's action_handlers (exact match or "*" catch-all), or null.
   *   You can return these directly, modify them, or ignore them.
   * @returns A2UI operations to apply optimistically, or null to skip.
   */
  handler: (
    action: A2UIUserAction,
    declaredOps: A2UIDeclaredOps,
  ) => A2UIOps | null | undefined | void;
}

/**
 * Register an optimistic action handler for A2UI surfaces.
 *
 * When a user clicks a button in an A2UI surface, registered handlers
 * are checked. The first handler whose actionName matches and returns
 * operations wins — the operations are applied to the surface immediately,
 * before the action reaches the agent.
 *
 * @example
 * ```tsx
 * useA2UIActionHandler({
 *   actionName: "book_flight",
 *   handler: (action) => [
 *     { surfaceUpdate: { surfaceId: action.surfaceId, components: bookedSchema } },
 *     { dataModelUpdate: { surfaceId: action.surfaceId, contents: [...] } },
 *     { beginRendering: { surfaceId: action.surfaceId, root: "root" } },
 *   ],
 * });
 * ```
 */
export function useA2UIActionHandler(
  registration: A2UIActionHandlerRegistration,
  deps: unknown[] = [],
) {
  const registry = useA2UIActionHandlerRegistry();
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    // Generate a stable ID for this registration
    if (!idRef.current) {
      idRef.current = `a2ui-handler-${Math.random().toString(36).slice(2)}`;
    }

    registry.register(idRef.current, registration);

    return () => {
      if (idRef.current) {
        registry.unregister(idRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, registration.actionName, ...deps]);
}
