"use client";

import React, { useLayoutEffect, useRef } from "react";
import type { Message } from "@ag-ui/core";
import { UserBubble } from "./user-bubble";
import { AssistantBubble } from "./assistant-bubble";
import { TypingIndicator } from "./typing-indicator";
import { useRenderedMessages } from "./use-rendered-messages";

/**
 * Scrollable messages area — TRULY headless.
 *
 * The per-message generative-UI weave (text, reasoning, tool-call renders,
 * activity messages, custom-before / custom-after) is composed inline by
 * `useRenderedMessages`, which returns a flat list of messages each carrying
 * a precomputed `renderedContent` field. Here we simply dispatch on role
 * and drop that node into the appropriate bubble chrome — no
 * `<CopilotChatMessageView>`, no `<CopilotChatAssistantMessage>`.
 *
 * See `use-rendered-messages.tsx` for the composition logic; it mirrors
 * `packages/react-core/src/v2/components/chat/CopilotChatMessageView.tsx:542-612`.
 */
export function MessageList({
  messages,
  isRunning,
}: {
  messages: Message[];
  isRunning: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const renderedMessages = useRenderedMessages(messages, isRunning);

  // Auto-scroll on streaming content changes (not just new messages).
  const fingerprint = messages
    .map((m) => {
      const contentLen =
        typeof m.content === "string"
          ? m.content.length
          : Array.isArray(m.content)
            ? m.content.length
            : 0;
      const tcLen =
        "toolCalls" in m && Array.isArray(m.toolCalls)
          ? m.toolCalls.map((tc) => tc.function.arguments.length).join(",")
          : "";
      return `${m.id}:${m.role}:${contentLen}:${tcLen}`;
    })
    .join("|");

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [fingerprint, isRunning]);

  return (
    <div
      ref={scrollRef}
      data-testid="headless-complete-messages"
      className="flex-1 min-h-0 overflow-y-auto px-4 py-4"
    >
      <div className="space-y-3">
        {renderedMessages.length === 0 && (
          <div className="text-center text-sm text-[#838389] mt-8">
            Try weather, a stock price, or a highlighted note.
          </div>
        )}
        {renderedMessages.map((m) => {
          // Tool-role messages are folded into the preceding assistant
          // message's tool-call renders; `renderedContent` is null for them.
          if (m.renderedContent == null) return null;
          if (m.role === "user") {
            return <UserBubble key={m.id}>{m.renderedContent}</UserBubble>;
          }
          return (
            <AssistantBubble key={m.id}>{m.renderedContent}</AssistantBubble>
          );
        })}
        {isRunning && <TypingIndicator />}
      </div>
    </div>
  );
}
