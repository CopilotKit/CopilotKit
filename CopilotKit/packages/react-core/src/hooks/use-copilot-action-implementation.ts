import { useRef, useContext, useEffect } from "react";
import { FrontendAction } from "../types/frontend-action";
import { CopilotContext } from "../context/copilot-context";
import { nanoid } from "nanoid";

// We implement useCopilotActionImplementation dependency handling so that
// the developer has the option to not provide any dependencies.
// In this case, we assume they want to update the handler on each rerender.
// To avoid getting stuck in an infinite loop, we update the handler directly,
// skipping React state updates.
// This is ok in this case, because the handler is not part of any UI that
// needs to be updated.
// useCallback, useMemo or other memoization techniques are not suitable here,
// because they will cause a infinite rerender loop.
export function useCopilotActionImplementation<T extends Array<any> = []>(
  action: FrontendAction<T>,
  dependencies?: any[],
): void {
  const { setEntryPoint, removeEntryPoint, entryPoints, chatComponentsCache } =
    useContext(CopilotContext);
  const idRef = useRef<string>(nanoid());

  // If the developer doesn't provide dependencies, we assume they want to
  // update handler and render function when the action object changes.
  // This ensures that any captured variables in the handler are up to date.
  if (dependencies === undefined) {
    if (entryPoints[idRef.current]) {
      entryPoints[idRef.current].handler = action.handler;
      if (typeof action.render === "function") {
        if (chatComponentsCache.current !== null) {
          chatComponentsCache.current[action.name] = action.render;
        }
      }
    }
  }

  useEffect(() => {
    setEntryPoint(idRef.current, action);
    if (chatComponentsCache.current !== null && action.render !== undefined) {
      chatComponentsCache.current[action.name] = action.render;
    }
    return () => {
      // NOTE: For now, we don't remove the chatComponentsCache entry when the action is removed.
      // This is because we currently don't have access to the messages array in CopilotContext.
      removeEntryPoint(idRef.current);
    };
  }, [
    setEntryPoint,
    removeEntryPoint,
    action.description,
    action.name,
    // This should be faster than deep equality checking
    // In addition, all major JS engines guarantee the order of object keys
    JSON.stringify(action.parameters),
    // include render only if it's a string
    typeof action.render === "string" ? action.render : undefined,
    // dependencies set by the developer
    ...(dependencies || []),
  ]);
}
