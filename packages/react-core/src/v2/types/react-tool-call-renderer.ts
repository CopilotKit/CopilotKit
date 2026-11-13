import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { ToolCallStatus } from "@copilotkit/core";

export interface ReactToolCallRenderer<T = unknown> {
  name: string;
  /**
   * Schema describing the tool arguments. Optional — renderers registered for
   * tools without parameters (e.g. HITL confirm dialogs) have no schema.
   */
  args?: StandardSchemaV1<any, T>;
  /**
   * Optional agent ID to constrain this tool renderer to a specific agent.
   * If specified, this renderer will only be used for the specified agent.
   */
  agentId?: string;
  /**
   * Whether calls this renderer draws join the chat's tool-call groups (see
   * `toolCallDisplay` on `CopilotChatMessageView`). CopilotKit's built-in card
   * sets it; a renderer that leaves it unset always shows its calls on their
   * own, since the chat can't tell what it draws (it may even draw nothing).
   */
  group?: boolean;
  render: React.ComponentType<
    | {
        name: string;
        toolCallId: string;
        args: Partial<T>;
        status: ToolCallStatus.InProgress;
        result: undefined;
        error?: undefined;
      }
    | {
        name: string;
        toolCallId: string;
        args: T;
        status: ToolCallStatus.Executing;
        result: undefined;
        error?: undefined;
      }
    | {
        name: string;
        toolCallId: string;
        args: T;
        status: ToolCallStatus.Complete;
        result: string;
        /**
         * Set when the tool call failed instead of returning a result. This is
         * the tool message's raw `error` field: usually the failure message,
         * but some history adapters restore it as a bare marker such as
         * `"error"`, and `result` then holds the text the agent was sent
         * (`Error: <message>` when CopilotKit produced it). An adapter can
         * also drop `error` from a restored message entirely, so a missing
         * `error` does not prove that the call succeeded.
         */
        error?: string;
      }
  >;
}
