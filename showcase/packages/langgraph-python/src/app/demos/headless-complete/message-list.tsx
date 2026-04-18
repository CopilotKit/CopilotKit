"use client";

import React, { useLayoutEffect, useRef } from "react";
import type { AssistantMessage, Message, UserMessage } from "@ag-ui/core";
import { UserBubble } from "./user-bubble";
import { AssistantBubble } from "./assistant-bubble";
import { TypingIndicator } from "./typing-indicator";

/**
 * Scrollable messages area. Auto-scrolls to the bottom whenever the message
 * list grows or existing content streams in. Only user + assistant messages
 * are rendered here — tool (`role: "tool"`) messages are consumed inline by
 * the assistant bubble that produced the tool call.
 */
export function MessageList({
  messages,
  isRunning,
}: {
  messages: Message[];
  isRunning: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build a cheap fingerprint so we auto-scroll on streaming content changes
  // (not just new messages). Mirrors the approach used elsewhere in the SDK.
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
      return `${m.id}:${contentLen}:${tcLen}`;
    })
    .join("|");

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [fingerprint, isRunning]);

  const visible = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  return (
    <div
      ref={scrollRef}
      data-testid="headless-complete-messages"
      className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
    >
      {visible.length === 0 && (
        <div className="text-center text-sm text-gray-400 mt-8">
          Ask for a bar chart or a pie chart to see inline tool rendering.
        </div>
      )}
      {visible.map((m) =>
        m.role === "user" ? (
          <UserBubble key={m.id} message={m as UserMessage} />
        ) : (
          <AssistantBubble
            key={m.id}
            message={m as AssistantMessage}
            allMessages={messages}
          />
        ),
      )}
      {isRunning && <TypingIndicator />}
    </div>
  );
}
