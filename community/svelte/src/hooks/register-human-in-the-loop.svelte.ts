import { getContext } from "svelte";
import type { FrontendToolHandlerContext } from "@copilotkit/core";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";
import type {
  SvelteFrontendTool,
  SvelteHumanInTheLoop,
  SvelteToolCallRenderer,
  SvelteToolCallRendererRenderProps,
} from "../types";

export function registerHumanInTheLoop<T extends Record<string, unknown>>(
  tool: SvelteHumanInTheLoop<T>,
) {
  const context = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error(
      "registerHumanInTheLoop must be used within CopilotKitProvider",
    );
  }

  const pendingResponses: Record<
    string,
    | {
        resolve: (result: unknown) => void;
        reject: (error: Error) => void;
        cleanupAbort?: () => void;
      }
    | undefined
  > = {};

  const respond = async (toolCallId: string, result: unknown) => {
    const pending = pendingResponses[toolCallId];
    if (!pending) return;
    pending.cleanupAbort?.();
    delete pendingResponses[toolCallId];
    pending.resolve(result);
  };

  const handler = async (
    _args: T,
    { toolCall, signal }: FrontendToolHandlerContext,
  ) => {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Human-in-the-loop interaction aborted"));
        return;
      }

      const pending = {
        resolve,
        reject,
        cleanupAbort: undefined as (() => void) | undefined,
      };
      pendingResponses[toolCall.id] = pending;

      if (signal) {
        const onAbort = () => {
          delete pendingResponses[toolCall.id];
          reject(new Error("Human-in-the-loop interaction aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        pending.cleanupAbort = () =>
          signal.removeEventListener("abort", onAbort);
      }
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
      respond:
        props.status === "executing"
          ? (result: unknown) => respond(props.toolCallId, result)
          : undefined,
    };
    return ToolComponent(
      extendedProps as Parameters<SvelteHumanInTheLoop<T>["render"]>[0],
    );
  };

  const frontendTool: SvelteFrontendTool<T> = {
    ...tool,
    type: "human-in-the-loop",
    handler,
    render: RenderComponent,
  };

  $effect(() => {
    const core = context.copilotkit;
    core.addHookFrontendTool(frontendTool);
    const name = tool.name;
    core.addHookRenderToolCall({
      name,
      args: tool.parameters,
      agentId: tool.agentId,
      render: RenderComponent,
    } as SvelteToolCallRenderer<unknown>);
    return () => {
      for (const pending of Object.values(pendingResponses)) {
        if (!pending) continue;
        pending.cleanupAbort?.();
        pending.reject(new Error("Human-in-the-loop interaction aborted"));
      }
      for (const toolCallId of Object.keys(pendingResponses)) {
        delete pendingResponses[toolCallId];
      }
      core.removeHookFrontendTool(name, tool.agentId);
      core.removeHookRenderToolCall(name, tool.agentId);
    };
  });
}
