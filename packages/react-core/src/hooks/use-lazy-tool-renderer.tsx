import { useRenderToolCall } from "../v2";
import { AIMessage, Message, ToolResult } from "@copilotkit/shared";
import React, { useCallback } from "react";

export function useLazyToolRenderer(): (
  message?: AIMessage,
  messages?: Message[],
) => null | (() => ReturnType<ReturnType<typeof useRenderToolCall>> | null) {
  const renderToolCall = useRenderToolCall();

  return useCallback(
    (message?: AIMessage, messages?: Message[]) => {
      const toolCalls = message?.toolCalls;
      if (!toolCalls?.length) return null;

      return () => {
        // An assistant message can carry a parallel batch of tool calls, so
        // every one of them gets rendered. Reading only `toolCalls[0]` silently
        // dropped 2..N, which from the user's seat is indistinguishable from a
        // tool result that never arrived.
        const rendered = toolCalls.map((toolCall) => {
          if (!toolCall) return null;

          const toolMessage = messages?.find(
            (m) => m.role === "tool" && m.toolCallId === toolCall.id,
          ) as ToolResult;

          const element = renderToolCall({ toolCall, toolMessage });
          return element ? (
            <React.Fragment key={toolCall.id}>{element}</React.Fragment>
          ) : null;
        });

        // No tool call produced output — no named or wildcard renderer is
        // registered for any of them. Return null rather than an empty fragment
        // so the caller still falls through to its custom-message renderer.
        if (rendered.every((element) => element === null)) return null;

        return <>{rendered}</>;
      };
    },
    [renderToolCall],
  );
}
