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
  /**
   * Whether calls this renderer draws join the chat's tool-call groups (see
   * `toolCallDisplay` on `CopilotChatMessageView`). CopilotKit's built-in card
   * sets it; a renderer that leaves it unset always shows its calls on their
   * own, since the chat can't tell what it draws (it may even draw nothing).
   */
  group?: boolean;
  render: VueToolCallRendererRenderFn<T>;
}
