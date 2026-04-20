"use client";

import React from "react";
import { useRenderToolCall } from "@copilotkit/react-core/v2";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";

/**
 * Left-aligned assistant message bubble.
 *
 * Renders the assistant's text (if any) plus inline tool-call UI via
 * `useRenderToolCall`. Each tool call is paired with its matching
 * `ToolMessage` (looked up by `toolCallId`) so the renderer can show the
 * result once it streams back.
 */
export function AssistantBubble({
  message,
  allMessages,
}: {
  message: AssistantMessage;
  allMessages: Message[];
}) {
  const renderToolCall = useRenderToolCall();
  const text = message.content ?? "";
  const toolCalls = message.toolCalls ?? [];
  const hasText = text.length > 0;
  const hasTools = toolCalls.length > 0;

  if (!hasText && !hasTools) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] flex flex-col gap-2">
        {hasText && (
          <div className="rounded-2xl rounded-bl-sm bg-gray-100 text-gray-900 px-4 py-2 text-sm whitespace-pre-wrap break-words">
            {text}
          </div>
        )}
        {hasTools && (
          <div className="flex flex-col gap-2">
            {toolCalls.map((tc) => {
              const toolMessage = allMessages.find(
                (m) => m.role === "tool" && m.toolCallId === tc.id,
              ) as ToolMessage | undefined;
              return (
                <React.Fragment key={tc.id}>
                  {renderToolCall({ toolCall: tc, toolMessage })}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
