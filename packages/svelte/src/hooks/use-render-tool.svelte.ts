import { getContext } from "svelte";
import { z } from "zod";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";
import type {
  SvelteToolCallRenderer,
  SvelteToolCallRendererRenderProps,
} from "../types";

export type RenderToolInProgressProps<S extends StandardSchemaV1> = {
  name: string;
  toolCallId: string;
  parameters: Partial<Record<string, unknown>>;
  status: "inProgress";
  result: undefined;
};

export type RenderToolExecutingProps<S extends StandardSchemaV1> = {
  name: string;
  toolCallId: string;
  parameters: Record<string, unknown>;
  status: "executing";
  result: undefined;
};

export type RenderToolCompleteProps<S extends StandardSchemaV1> = {
  name: string;
  toolCallId: string;
  parameters: Record<string, unknown>;
  status: "complete";
  result: string;
};

export type RenderToolProps<S extends StandardSchemaV1> =
  | RenderToolInProgressProps<S>
  | RenderToolExecutingProps<S>
  | RenderToolCompleteProps<S>;

export function useRenderTool(config: {
  name: string;
  parameters?: StandardSchemaV1<any, any>;
  render: (props: RenderToolProps<StandardSchemaV1<any, any>>) => any;
  agentId?: string;
}): void {
  const context = getContext<CopilotKitContextValue>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("useRenderTool must be used within CopilotKitProvider");
  }

  $effect(() => {
    const schema =
      config.name === "*" && !config.parameters
        ? z.any()
        : (config.parameters ?? z.any());

    const renderer: SvelteToolCallRenderer<unknown> = {
      name: config.name,
      args: schema as StandardSchemaV1<any, unknown>,
      render: (props: SvelteToolCallRendererRenderProps<unknown>) =>
        config.render({
          ...props,
          parameters: props.args as Record<string, unknown>,
        } as RenderToolProps<StandardSchemaV1<any, any>>),
      ...(config.agentId ? { agentId: config.agentId } : {}),
    };

    context.copilotkit.addHookRenderToolCall(renderer);
  });
}
