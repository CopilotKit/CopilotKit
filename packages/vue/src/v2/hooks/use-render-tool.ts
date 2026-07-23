import { h, watch } from "vue";
import type { Component, WatchSource, VNodeChild } from "vue";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import { useCopilotKit } from "../providers/useCopilotKit";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import type {
  VueToolCallRenderer,
  VueToolCallRendererRenderProps,
} from "../types";

const EMPTY_DEPS: WatchSource<unknown>[] = [];

export interface RenderToolInProgressProps<S extends StandardSchemaV1> {
  name: string;
  toolCallId: string;
  parameters: Partial<InferSchemaOutput<S>>;
  status: "inProgress";
  result: undefined;
}

export interface RenderToolExecutingProps<S extends StandardSchemaV1> {
  name: string;
  toolCallId: string;
  parameters: InferSchemaOutput<S>;
  status: "executing";
  result: undefined;
}

export interface RenderToolCompleteProps<S extends StandardSchemaV1> {
  name: string;
  toolCallId: string;
  parameters: InferSchemaOutput<S>;
  status: "complete";
  result: string;
}

export type RenderToolProps<S extends StandardSchemaV1> =
  | RenderToolInProgressProps<S>
  | RenderToolExecutingProps<S>
  | RenderToolCompleteProps<S>;

type RenderToolConfig<S extends StandardSchemaV1> = {
  name: string;
  parameters?: S;
  render:
    | ((props: RenderToolProps<S>) => VNodeChild)
    | Component<RenderToolProps<S>>;
  agentId?: string;
};

export function useRenderTool(
  config: {
    name: "*";
    render: ((props: any) => VNodeChild) | Component<any>;
    agentId?: string;
  },
  deps?: WatchSource<unknown>[],
): void;

export function useRenderTool<S extends StandardSchemaV1>(
  config: {
    name: string;
    parameters: S;
    render:
      | ((props: RenderToolProps<S>) => VNodeChild)
      | Component<RenderToolProps<S>>;
    agentId?: string;
  },
  deps?: WatchSource<unknown>[],
): void;

export function useRenderTool<S extends StandardSchemaV1>(
  config: RenderToolConfig<S>,
  deps?: WatchSource<unknown>[],
): void {
  const { copilotkit } = useCopilotKit();
  const extraDeps = deps ?? EMPTY_DEPS;

  watch(
    [
      () => copilotkit.value,
      () => config.name,
      () => config.agentId,
      () => extraDeps.length,
      ...extraDeps,
    ],
    () => {
      const renderTool = (props: RenderToolProps<S>): VNodeChild => {
        if (typeof config.render === "function") {
          return (config.render as (props: RenderToolProps<S>) => VNodeChild)(
            props,
          );
        }
        return h(config.render, props);
      };

      const renderer =
        config.name === "*" && !config.parameters
          ? defineToolCallRenderer({
              name: "*",
              render: (props: VueToolCallRendererRenderProps<unknown>) =>
                renderTool({
                  ...props,
                  parameters: props.args,
                } as RenderToolProps<S>),
              ...(config.agentId ? { agentId: config.agentId } : {}),
            })
          : defineToolCallRenderer({
              name: config.name,
              args: config.parameters!,
              render: (
                props: VueToolCallRendererRenderProps<InferSchemaOutput<S>>,
              ) =>
                renderTool({
                  ...props,
                  parameters: props.args,
                } as RenderToolProps<S>),
              ...(config.agentId ? { agentId: config.agentId } : {}),
            });

      copilotkit.value.addHookRenderToolCall(
        renderer as VueToolCallRenderer<unknown>,
      );
      // Intentionally no cleanup removal to preserve renderers for chat history.
    },
    { immediate: true },
  );
}
