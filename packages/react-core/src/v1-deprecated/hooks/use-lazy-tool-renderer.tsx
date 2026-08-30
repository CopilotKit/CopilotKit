/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useLazyToolRenderer:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Tool rendering): https://docs.copilotkit.ai/generative-ui/tool-rendering
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { useRenderToolCall } from "../../v2";
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
      const toolCalls = message.toolCalls;

      return () => {
        const renderedToolCalls = toolCalls
          .map((toolCall) => {
            const toolMessage = messages?.find(
              (m) => m.role === "tool" && m.toolCallId === toolCall.id,
            ) as ToolResult;

            return renderToolCall({
              toolCall,
              toolMessage,
            });
          })
          .filter((renderedToolCall) => renderedToolCall !== null);

        if (!renderedToolCalls.length) return null;

        return <>{renderedToolCalls}</>;
      };
    },
    [renderToolCall],
  );
}
