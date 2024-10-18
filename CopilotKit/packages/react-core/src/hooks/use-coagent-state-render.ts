import { useRef, useContext, useEffect } from "react";
import { CopilotContext } from "../context/copilot-context";
import { randomId } from "@copilotkit/shared";
import { CoAgentStateRender } from "../types/coagent-action";

// We implement useCoAgentStateRender dependency handling so that
// the developer has the option to not provide any dependencies.
// see useCopilotAction for more details about this approach.
export function useCoAgentStateRender<T = any>(
  action: CoAgentStateRender<T>,
  dependencies?: any[],
): void {
  const {
    setCoAgentStateRender,
    removeCoAgentStateRender,
    coAgentStateRenders,
    chatComponentsCache,
  } = useContext(CopilotContext);
  const idRef = useRef<string>(randomId());

  const key = `${action.name}-${action.nodeName || "global"}`;

  if (dependencies === undefined) {
    if (coAgentStateRenders[idRef.current]) {
      coAgentStateRenders[idRef.current].handler = action.handler as any;
      if (typeof action.render === "function") {
        if (chatComponentsCache.current !== null) {
          chatComponentsCache.current.coAgentStateRenders[key] = action.render;
        }
      }
    }
  }

  useEffect(() => {
    setCoAgentStateRender(idRef.current, action as any);
    if (chatComponentsCache.current !== null && action.render !== undefined) {
      chatComponentsCache.current.coAgentStateRenders[key] = action.render;
    }
    return () => {
      removeCoAgentStateRender(idRef.current);
    };
  }, [
    setCoAgentStateRender,
    removeCoAgentStateRender,
    action.name,
    // include render only if it's a string
    typeof action.render === "string" ? action.render : undefined,
    // dependencies set by the developer
    ...(dependencies || []),
  ]);
}
