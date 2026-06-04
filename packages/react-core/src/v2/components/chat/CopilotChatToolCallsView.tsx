import { useRenderToolCall } from "../../hooks";
import type {
  AssistantMessage,
  Message,
  ToolCall,
  ToolMessage,
} from "@ag-ui/core";
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
      {deduplicateToolCalls(message.toolCalls).map((toolCall) => {
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

function deduplicateToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  const uniqueToolCalls = new Map<string, ToolCall>();

  for (const toolCall of toolCalls) {
    const existingToolCall = uniqueToolCalls.get(toolCall.id);
    if (
      !existingToolCall ||
      isMoreCompleteToolCall(toolCall, existingToolCall)
    ) {
      uniqueToolCalls.set(toolCall.id, toolCall);
    }
  }

  return [...uniqueToolCalls.values()];
}

function isMoreCompleteToolCall(
  nextToolCall: ToolCall,
  currentToolCall: ToolCall,
): boolean {
  return (
    nextToolCall.function.arguments.trim().length >
    currentToolCall.function.arguments.trim().length
  );
}
