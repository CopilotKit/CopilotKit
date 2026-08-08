import { useRenderToolCall } from "../../hooks";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import React from "react";

export type CopilotChatToolCallsViewProps = {
  message: AssistantMessage;
  messages?: Message[];
};

export function CopilotChatToolCallsView({
  message,
  messages = [],
}: CopilotChatToolCallsViewProps) {
  const renderToolCall = useRenderToolCall();

  if (!message.toolCalls || message.toolCalls.length === 0) {
    return null;
  }

  // Deduplicate tool calls by id. When connectAgent() replays historic
  // TOOL_CALL_START events over a pre-populated messages state, the same
  // toolCallId can appear more than once in the array, which causes React to
  // emit a duplicate-key warning. Keep the last occurrence so that the most
  // up-to-date arguments are used.
  const uniqueToolCalls = [
    ...new Map(message.toolCalls.map((tc) => [tc.id, tc])).values(),
  ];

  return (
    <>
      {uniqueToolCalls.map((toolCall) => {
        const toolMessage = messages.find(
          (m) => m.role === "tool" && m.toolCallId === toolCall.id,
        ) as ToolMessage | undefined;

        return (
          <React.Fragment key={toolCall.id}>
            {renderToolCall({
              toolCall,
              toolMessage,
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default CopilotChatToolCallsView;
