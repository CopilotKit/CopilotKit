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

  return (
    <>
      {message.toolCalls.map((toolCall) => {
        const toolMessage = messages.find(
          (m) => m.role === "tool" && m.toolCallId === toolCall.id,
        ) as ToolMessage | undefined;

        // `display: contents` keeps layout unchanged. The id lets interaction
        // capture tie a click inside the rendered tool UI to this tool call.
        return (
          <div
            key={toolCall.id}
            data-tool-call-id={toolCall.id}
            style={{ display: "contents" }}
          >
            {renderToolCall({
              toolCall,
              toolMessage,
            })}
          </div>
        );
      })}
    </>
  );
}

export default CopilotChatToolCallsView;
