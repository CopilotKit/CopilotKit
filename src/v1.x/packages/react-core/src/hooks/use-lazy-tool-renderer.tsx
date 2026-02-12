import { useRenderToolCall } from "@copilotkitnext/react";
import { AIMessage, Message, ToolResult } from "@copilotkit/shared";
import { useCallback } from "react";

export function useLazyToolRenderer(): (
  message?: AIMessage,
  messages?: Message[],
) => null | (() => ReturnType<ReturnType<typeof useRenderToolCall>>[] | null) {
  const renderToolCall = useRenderToolCall();

  return useCallback(
    (message?: AIMessage, messages?: Message[]) => {
      const { toolCalls } = message || {};
      const renderToolCalls = () => {
        if (!toolCalls || toolCalls.length === 0) return [];
        return toolCalls.map((toolCall) => {
          const toolMessage = messages?.find(
            (m) => m.role === "tool" && m.toolCallId === toolCall.id,
          ) as ToolResult;
          return renderToolCall({ toolCall, toolMessage });
        });  // Map over all tool calls
      };
      return renderToolCalls;
    },
    [renderToolCall],
  );
}
