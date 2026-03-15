import { useEffect, useRef } from "react";
import type { A2UIActionHandler } from "../a2ui/A2UIMessageRenderer";
import { useA2UIActionHandlerRegistry } from "../providers/A2UIActionHandlerRegistry";

/**
 * Register an optimistic action handler for A2UI surfaces.
 *
 * The handler is called for every A2UI action dispatched (e.g., button click).
 * It receives the action and any pre-declared ops from the agent, and can
 * return A2UI operations to apply optimistically before the agent responds.
 *
 * Return a non-empty array to apply ops. Return null/undefined to skip
 * (the next handler or fallback will be tried).
 *
 * @param handler - Called with (action, declaredOps). The handler decides
 *   whether to handle this action based on action.name, surfaceId, context, etc.
 * @param deps - Dependency array (like useEffect). Handler is re-registered when deps change.
 *
 * @example
 * ```tsx
 * // Handle a specific action
 * useA2UIActionHandler((action, declaredOps) => {
 *   if (action.name === "book_flight") {
 *     return [
 *       { surfaceUpdate: { surfaceId: action.surfaceId, components: bookedSchema } },
 *       { beginRendering: { surfaceId: action.surfaceId, root: "root" } },
 *     ];
 *   }
 *   return null; // skip — let other handlers try
 * });
 *
 * // Delegate to pre-declared ops from the agent
 * useA2UIActionHandler((action, declaredOps) => {
 *   if (action.name === "book_flight") return declaredOps;
 *   return null;
 * });
 *
 * // Handle all actions on a specific surface
 * useA2UIActionHandler((action, declaredOps) => {
 *   if (action.surfaceId === "my-surface") return declaredOps;
 *   return null;
 * });
 * ```
 */
export function useA2UIActionHandler(
  handler: A2UIActionHandler,
  deps: unknown[] = [],
) {
  const registry = useA2UIActionHandlerRegistry();
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    if (!idRef.current) {
      idRef.current = `a2ui-handler-${Math.random().toString(36).slice(2)}`;
    }

    registry.register(idRef.current, handler);

    return () => {
      if (idRef.current) {
        registry.unregister(idRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, ...deps]);
}
