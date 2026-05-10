"use client";

import React, { useLayoutEffect, useRef } from "react";
import type { Message } from "@ag-ui/core";
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
 * `packages/react-core/src/v2/components/chat/CopilotChatMessageView.tsx`.
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
            Try weather, a stock, a highlighted note, or an Excalidraw sketch.
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

/**
 * Right-aligned user bubble — pure chrome.
 */
// @region[custom-bubbles]
function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[#010507] text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}

/**
 * Left-aligned assistant bubble — pure chrome.
 *
 * An empty node (e.g. an assistant message that has neither text nor tool
 * calls yet) is suppressed so the bubble doesn't flash an empty rounded box
 * while streaming hasn't started.
 */
function AssistantBubble({ children }: { children: React.ReactNode }) {
  if (isEmpty(children)) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] flex flex-col gap-2">
        <div className="rounded-2xl rounded-bl-sm bg-[#F0F0F4] text-[#010507] px-4 py-2 text-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
// @endregion[custom-bubbles]

function isEmpty(node: React.ReactNode): boolean {
  if (node == null || node === false) return true;
  if (typeof node === "string") return node.trim().length === 0;
  if (Array.isArray(node)) return node.every(isEmpty);
  return false;
}

/**
 * Small animated dot shown while the agent is running but has not yet emitted
 * any assistant content. Styled to look like an assistant bubble so it slots
 * into the message list without layout jitter.
 */
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-bl-sm bg-[#F0F0F4] px-4 py-3">
        <span className="inline-block w-2 h-2 bg-[#838389] rounded-full animate-pulse" />
      </div>
    </div>
  );
}
