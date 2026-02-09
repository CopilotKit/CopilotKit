import { useToolCallRenderer } from "@copilotkitnext/react";
import { AIMessage, Message, ToolResult } from "@copilotkit/shared";
import React, { useCallback, useRef } from "react";

export function useLazyToolRenderer(): (
  message?: AIMessage,
  messages?: Message[],
) => null | (() => React.ReactElement | null) {
  // Store messages in a ref to avoid recreating the callback
  const messagesRef = useRef<Message[]>([]);

  // We need to call useToolCallRenderer unconditionally, but we'll pass
  // the messages via ref when the returned function is called
  const { renderToolCall } = useToolCallRenderer();

  return useCallback(
    (message?: AIMessage, messages?: Message[]) => {
      if (!message?.toolCalls?.length) return null;

      const toolCall = message.toolCalls[0];
      if (!toolCall) return null;

      // Store messages in ref for lookup
      messagesRef.current = messages ?? [];

      // Find the tool message manually since we can't pass messages to the hook
      // (hook was already called without messages)
      const toolMessage = messagesRef.current.find(
        (m) => m.role === "tool" && m.toolCallId === toolCall.id,
      ) as ToolResult | undefined;

      return () =>
        renderToolCall({
          toolCall,
          toolMessage,
        });
    },
    [renderToolCall],
  );
}
