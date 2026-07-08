import type { ToolCallStatus } from "@copilotkit/core";
import type { StandardSchemaV1 } from "@copilotkit/shared";

export type SvelteToolCallRendererRenderProps<T> =
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

export type SvelteToolCallRendererRenderFn<T> = (
  props: SvelteToolCallRendererRenderProps<T>,
) => any;

export interface SvelteToolCallRenderer<T = unknown> {
  name: string;
  args: StandardSchemaV1<any, T>;
  agentId?: string;
  render: SvelteToolCallRendererRenderFn<T>;
}
