"use client";

import React from "react";
import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import type { AssistantMessage, Message } from "@ag-ui/core";

/**
 * Left-aligned assistant bubble.
 *
 * This is the `assistantMessage` slot passed to `<CopilotChatMessageView>`.
 * It wraps the default `<CopilotChatAssistantMessage>` primitive — which
 * already composes the FULL generative UI for an assistant message:
 *   - markdown / text content
 *   - tool-call renderings (honoring every `useRenderTool`, `useDefaultRenderTool`,
 *     `useFrontendTool`, and `useComponent` registration — and the built-in
 *     A2UI tool-call renderer registered by `CopilotKitProvider`)
 * A2UI activity messages, MCP Apps activity messages, reasoning messages, and
 * custom messages are rendered by `CopilotChatMessageView` at the message-list
 * level (not inside the assistant bubble), so those render automatically
 * alongside these bubbles — no extra wiring needed here.
 *
 * Canonical reference:
 *   packages/react-core/src/v2/components/chat/CopilotChatAssistantMessage.tsx
 *   packages/react-core/src/v2/components/chat/CopilotChatToolCallsView.tsx
 */
export function AssistantBubble({
  message,
  messages,
  isRunning,
}: {
  message: AssistantMessage;
  messages?: Message[];
  isRunning?: boolean;
}) {
  const hasText = !!(message.content && message.content.trim().length > 0);
  const hasTools = !!(message.toolCalls && message.toolCalls.length > 0);

  // Suppress empty assistant shells (no text, no tool calls) so the bubble
  // doesn't flash an empty rounded box while streaming hasn't started yet.
  if (!hasText && !hasTools) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] flex flex-col gap-2">
        <div className="rounded-2xl rounded-bl-sm bg-gray-100 text-gray-900 px-4 py-2 text-sm">
          <CopilotChatAssistantMessage
            message={message}
            messages={messages}
            isRunning={isRunning}
            toolbarVisible={false}
            className="!m-0"
          />
        </div>
      </div>
    </div>
  );
}
