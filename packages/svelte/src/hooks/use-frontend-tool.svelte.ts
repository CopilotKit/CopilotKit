import { getContext } from "svelte";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";
import type { SvelteFrontendTool } from "../types";
import type { SvelteToolCallRenderer } from "../types";

export function useFrontendTool<T extends Record<string, unknown>>(
  tool: SvelteFrontendTool<T>,
) {
  const context = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("useFrontendTool must be used within CopilotKitProvider");
  }

  $effect(() => {
    const core = context.copilotkit;
    const name = tool.name;

    if (core.getTool({ toolName: name, agentId: tool.agentId })) {
      console.warn(
        `Tool '${name}' already exists for agent '${tool.agentId || "global"}'. Overriding with latest registration.`,
      );
      core.removeTool(name, tool.agentId);
    }
    core.addTool(tool);

    if (tool.render) {
      core.addHookRenderToolCall({
        name,
        args: tool.parameters,
        agentId: tool.agentId,
        render: tool.render,
      } as SvelteToolCallRenderer<unknown>);
    }

    return () => {
      core.removeTool(name, tool.agentId);
    };
  });
}
