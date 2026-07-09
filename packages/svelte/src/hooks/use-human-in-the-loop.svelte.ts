import { getContext } from "svelte";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";
import type {
  SvelteFrontendTool,
  SvelteHumanInTheLoop,
  SvelteToolCallRenderer,
  SvelteToolCallRendererRenderProps,
} from "../types";

export function useHumanInTheLoop<T extends Record<string, unknown>>(
  tool: SvelteHumanInTheLoop<T>,
) {
  const context = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("useHumanInTheLoop must be used within CopilotKitProvider");
  }

  let resolvePromise: ((result: unknown) => void) | null = null;

  const respond = async (result: unknown) => {
    if (resolvePromise) {
      resolvePromise(result);
      resolvePromise = null;
    }
  };

  const handler = async () => {
    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  };

  const RenderComponent: SvelteToolCallRenderer<T>["render"] = (
    props: SvelteToolCallRendererRenderProps<T>,
  ) => {
    const ToolComponent = tool.render;
    const extendedProps = {
      ...props,
      name: tool.name,
      description: tool.description || "",
      respond: props.status === "executing" ? respond : undefined,
    };
    return ToolComponent(extendedProps as any);
  };

  const frontendTool: SvelteFrontendTool<T> = {
    ...tool,
    handler,
    render: RenderComponent,
  };

  $effect(() => {
    const core = context.copilotkit;
    core.addTool(frontendTool);
    const name = tool.name;
    if (tool.render) {
      core.addHookRenderToolCall({
        name,
        args: tool.parameters,
        agentId: tool.agentId,
        render: RenderComponent,
      } as SvelteToolCallRenderer<unknown>);
    }
    return () => {
      core.removeTool(name, tool.agentId);
      core.removeHookRenderToolCall(name, tool.agentId);
    };
  });
}
