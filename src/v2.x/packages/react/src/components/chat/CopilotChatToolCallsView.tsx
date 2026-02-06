import { useToolCallRenderer } from "@/hooks";
import { AssistantMessage, Message } from "@ag-ui/core";
import React from "react";

export type CopilotChatToolCallsViewProps = {
  message: AssistantMessage;
  messages?: Message[];
};

export function CopilotChatToolCallsView({
  message,
  messages = [],
}: CopilotChatToolCallsViewProps) {
  const renderToolCall = useToolCallRenderer({ messages });

  if (!message.toolCalls || message.toolCalls.length === 0) {
    return null;
  }

  return (
    <>
      {message.toolCalls.map((toolCall) => (
        <React.Fragment key={toolCall.id}>{renderToolCall(toolCall)}</React.Fragment>
      ))}
    </>
  );
}

export default CopilotChatToolCallsView;
