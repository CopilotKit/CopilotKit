import { useRenderToolCall } from "@/hooks";
import { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
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

  return (
    <>
      {message.toolCalls.map((toolCall) => {
        const toolMessage = messages.find(
          (m) => m.role === "tool" && m.toolCallId === toolCall.id
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
