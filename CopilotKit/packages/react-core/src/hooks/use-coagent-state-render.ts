import { useRef, useContext, useEffect } from "react";
import { CopilotContext } from "../context/copilot-context";
import { randomId } from "@copilotkit/shared";
import { CoagentAction } from "../types/coagent-action";

// We implement useCoAgentAction dependency handling so that
// the developer has the option to not provide any dependencies.
// see useCopilotAction for more details about this approach.
export function useCoagentStateRender<T = any>(
  action: CoagentAction<T>,
  dependencies?: any[],
): void {
  const { setCoagentAction, removeCoagentAction, coagentActions, chatComponentsCache } =
    useContext(CopilotContext);
  const idRef = useRef<string>(randomId());

  const key = `${action.name}-${action.nodeName || "global"}`;

  if (dependencies === undefined) {
    if (coagentActions[idRef.current]) {
      coagentActions[idRef.current].handler = action.handler as any;
      if (typeof action.render === "function") {
        if (chatComponentsCache.current !== null) {
          chatComponentsCache.current.coagentActions[key] = action.render;
        }
      }
    }
  }

  useEffect(() => {
    setCoagentAction(idRef.current, action as any);
    if (chatComponentsCache.current !== null && action.render !== undefined) {
      chatComponentsCache.current.coagentActions[key] = action.render;
    }
    return () => {
      removeCoagentAction(idRef.current);
    };
  }, [
    setCoagentAction,
    removeCoagentAction,
    action.name,
    // include render only if it's a string
    typeof action.render === "string" ? action.render : undefined,
    // dependencies set by the developer
    ...(dependencies || []),
  ]);
}
