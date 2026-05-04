import type { StandardSchemaV1 } from "@copilotkit/shared";
import { ToolCallStatus } from "@copilotkit/core";

export interface ReactToolCallRenderer<T = unknown> {
  name: string;
  args: StandardSchemaV1<any, T>;
  /**
   * Optional agent ID to constrain this tool renderer to a specific agent.
   * If specified, this renderer will only be used for the specified agent.
   */
  agentId?: string;
  render: React.ComponentType<
    | {
        name: string;
        args: Partial<T>;
        status: ToolCallStatus.InProgress;
        result: undefined;
      }
    | {
        name: string;
        args: T;
        status: ToolCallStatus.Executing;
        result: undefined;
      }
    | {
        name: string;
        args: T;
        status: ToolCallStatus.Complete;
        result: string;
      }
  >;
}
