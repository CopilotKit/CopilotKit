import { useRenderToolCall } from "../../hooks";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import React, { useContext } from "react";
import { SubagentLayoutContext } from "./CopilotChatSubagent";

export type CopilotChatToolCallsViewProps = {
  message: AssistantMessage;
  messages?: Message[];
};

export function CopilotChatToolCallsView({
  message,
  messages = [],
}: CopilotChatToolCallsViewProps) {
  const renderToolCall = useRenderToolCall();
  const subagents = useContext(SubagentLayoutContext);

  if (!message.toolCalls || message.toolCalls.length === 0) {
    return null;
  }

  return (
    <>
      {message.toolCalls.map((toolCall) => {
        const toolMessage = messages.find(
          (m) => m.role === "tool" && m.toolCallId === toolCall.id,
        ) as ToolMessage | undefined;

        return (
          <React.Fragment key={toolCall.id}>
            {renderToolCall({
              toolCall,
              toolMessage,
            })}
            {/* The subagents this call started, even when no renderer is registered for the call. */}
            {subagents?.layout.byToolCallId
              .get(toolCall.id)
              ?.map(subagents.renderGroup)}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default CopilotChatToolCallsView;
