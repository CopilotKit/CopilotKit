import { useLayoutEffect } from "react";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import type { ReactFrontendTool } from "../types/frontend-tool";

const EMPTY_DEPS: ReadonlyArray<unknown> = [];

export function useFrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
>(tool: ReactFrontendTool<T>, deps?: ReadonlyArray<unknown>) {
  const { copilotkit } = useCopilotKit();
  const extraDeps = deps ?? EMPTY_DEPS;

  useLayoutEffect(() => {
    const name = tool.name;

    // Always register/override the tool for this name on mount
    if (copilotkit.getTool({ toolName: name, agentId: tool.agentId })) {
      console.warn(
        `Tool '${name}' already exists for agent '${tool.agentId || "global"}'. Overriding with latest registration.`,
      );
      copilotkit.removeTool(name, tool.agentId);
    }
    copilotkit.addTool(tool);

    // Register/override renderer by name and agentId through core.
    // The render function is registered even when tool.parameters is
    // undefined — tools like HITL confirm dialogs have no parameters
    // but still need their UI rendered in the chat.
    if (tool.render) {
      copilotkit.addHookRenderToolCall({
        name,
        args: tool.parameters,
        agentId: tool.agentId,
        render: tool.render,
      });
    }

    return () => {
      copilotkit.removeTool(name, tool.agentId);
      // we are intentionally not removing the render here so that the tools can still render in the chat history
    };
    // Depend on stable keys by default and allow callers to opt into
    // additional dependencies for dynamic tool configuration.
    // tool.available is included so toggling availability re-registers the tool.
  }, [tool.name, tool.available, copilotkit, extraDeps.length, ...extraDeps]);
}
