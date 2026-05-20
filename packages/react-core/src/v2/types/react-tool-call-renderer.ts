import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { ToolCallStatus } from "@copilotkit/core";
import type { AgentId } from "./copilotkit-types";

export interface ReactToolCallRenderer<
  T = unknown,
  A extends AgentId | undefined = AgentId | undefined,
> {
  name: string;
  args: StandardSchemaV1<any, T>;
  /**
   * Optional agent ID to constrain this tool renderer to a specific agent.
   * If specified, this renderer will only be used for the specified agent.
   */
  agentId?: A;
  render: React.ComponentType<
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
      }
  >;
}
