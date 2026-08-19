import { getContext } from "svelte";
import { z } from "zod";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";
import type {
  SvelteToolCallRenderer,
  SvelteToolCallRendererRenderProps,
} from "../types";

export type RenderToolInProgressProps = {
  name: string;
  toolCallId: string;
  parameters: Partial<Record<string, unknown>>;
  status: "inProgress";
  result: undefined;
};

export type RenderToolExecutingProps = {
  name: string;
  toolCallId: string;
  parameters: Record<string, unknown>;
  status: "executing";
  result: undefined;
};

export type RenderToolCompleteProps = {
  name: string;
  toolCallId: string;
  parameters: Record<string, unknown>;
  status: "complete";
  result: string;
};

export type RenderToolProps =
  | RenderToolInProgressProps
  | RenderToolExecutingProps
  | RenderToolCompleteProps;

export function registerRenderToolCall(config: {
  name: string;
  parameters?: StandardSchemaV1<unknown, unknown>;
  render: (props: RenderToolProps) => unknown;
  agentId?: string;
}): void {
  const context = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error(
      "registerRenderToolCall must be used within CopilotKitProvider",
    );
  }

  $effect(() => {
    const schema =
      config.name === "*" && !config.parameters
        ? z.any()
        : (config.parameters ?? z.any());

    const renderer: SvelteToolCallRenderer<unknown> = {
      name: config.name,
      args: schema as StandardSchemaV1<unknown, unknown>,
      render: (props: SvelteToolCallRendererRenderProps<unknown>) =>
        config.render({
          ...props,
          parameters: props.args as Record<string, unknown>,
        } as RenderToolProps),
      ...(config.agentId ? { agentId: config.agentId } : {}),
    };

    context.copilotkit.addHookRenderToolCall(renderer);

    return () => {
      context.copilotkit.removeHookRenderToolCall(config.name, config.agentId);
    };
  });
}
