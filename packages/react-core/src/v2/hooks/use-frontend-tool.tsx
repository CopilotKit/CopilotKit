import { useEffect, useRef } from "react";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import type { ReactFrontendTool } from "../types/frontend-tool";

const EMPTY_DEPS: ReadonlyArray<unknown> = [];

export function useFrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
>(tool: ReactFrontendTool<T>, deps?: ReadonlyArray<unknown>) {
  const { copilotkit } = useCopilotKit();
  const extraDeps = deps ?? EMPTY_DEPS;

  // Store tool in a ref so the effect always reads the latest value
  // without needing `tool` (an inline object) in the dependency array.
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Serialize extraDeps so the dependency array is statically analyzable.
  const extraDepsKey = JSON.stringify(extraDeps);

  useEffect(() => {
    const currentTool = toolRef.current;
    const name = currentTool.name;

    // Always register/override the tool for this name on mount
    if (copilotkit.getTool({ toolName: name, agentId: currentTool.agentId })) {
      console.warn(
        `Tool '${name}' already exists for agent '${currentTool.agentId || "global"}'. Overriding with latest registration.`,
      );
      copilotkit.removeTool(name, currentTool.agentId);
    }
    copilotkit.addTool(currentTool);

    // Register/override renderer by name and agentId through core.
    // The render function is registered even when tool.parameters is
    // undefined — tools like HITL confirm dialogs have no parameters
    // but still need their UI rendered in the chat.
    if (currentTool.render) {
      copilotkit.addHookRenderToolCall({
        name,
        args: currentTool.parameters,
        agentId: currentTool.agentId,
        render: currentTool.render,
      });
    }

    return () => {
      copilotkit.removeTool(name, currentTool.agentId);
      // we are intentionally not removing the render here so that the tools can still render in the chat history
    };
    // Depend on stable keys by default and allow callers to opt into
    // additional dependencies for dynamic tool configuration.
    // tool.available is included so toggling availability re-registers the tool.
  }, [tool.name, tool.available, copilotkit, extraDepsKey]);
}
