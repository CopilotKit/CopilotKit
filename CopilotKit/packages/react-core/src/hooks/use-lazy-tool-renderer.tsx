import { useRenderToolCall } from "@copilotkitnext/react";
import { AIMessage, Message, ToolResult } from "@copilotkit/shared";
import React, { useCallback } from "react";

export function useLazyToolRenderer(): (
  message?: AIMessage,
  messages?: Message[],
) => null | (() => ReturnType<ReturnType<typeof useRenderToolCall>> | null) {
  const renderToolCall = useRenderToolCall();

  return useCallback(
    (message?: AIMessage, messages?: Message[]) => {
      if (!message?.toolCalls?.length) return null;

      const toolCall = message.toolCalls[0];
      if (!toolCall) return null;

      const toolMessage = messages?.find(
        (m) => m.role === "tool" && m.toolCallId === toolCall.id,
      ) as ToolResult;

      return () =>
        renderToolCall({
          toolCall,
          toolMessage,
        });
    },
    [renderToolCall],
  );
}
