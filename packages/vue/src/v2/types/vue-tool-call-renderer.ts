import type { ToolCallStatus } from "@copilotkit/core";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { Component, VNodeChild } from "vue";

/**
 * Props passed to a Vue tool call render function.
 */
export type VueToolCallRendererRenderProps<T> =
  | {
      name: string;
      toolCallId: string;
      args: Partial<T>;
      status: ToolCallStatus.InProgress;
      result: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: T;
      status: ToolCallStatus.Executing;
      result: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: T;
      status: ToolCallStatus.Complete;
      result: string;
    };

/**
 * Vue component or render function for tool call rendering.
 * Component is normalized to (props) => VNodeChild internally.
 */
export type VueToolCallRendererRenderFn<T> =
  | ((props: VueToolCallRendererRenderProps<T>) => VNodeChild)
  | Component<VueToolCallRendererRenderProps<T>>;

export interface VueToolCallRenderer<T = unknown> {
  name: string;
  args: StandardSchemaV1<any, T>;
  agentId?: string;
  render: VueToolCallRendererRenderFn<T>;
}
