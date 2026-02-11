import { useToolCallRenderer } from "@/hooks";
import { AssistantMessage, Message } from "@ag-ui/core";
import React from "react";

export type CopilotChatToolCallsViewProps = {
  message: AssistantMessage;
  messages?: Message[];
};

export function CopilotChatToolCallsView({ message, messages = [] }: CopilotChatToolCallsViewProps) {
  const { renderAllToolCalls } = useToolCallRenderer({ messages });

  if (!message.toolCalls || message.toolCalls.length === 0) {
    return null;
  }

  return <>{renderAllToolCalls(message.toolCalls)}</>;
}

export default CopilotChatToolCallsView;
