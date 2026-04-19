"use client";

import React, { useLayoutEffect, useRef } from "react";
import type { Message } from "@ag-ui/core";
import { CopilotChatMessageView } from "@copilotkit/react-core/v2";
import { UserBubble } from "./user-bubble";
import { AssistantBubble } from "./assistant-bubble";
import { TypingIndicator } from "./typing-indicator";

/**
 * Scrollable messages area.
 *
 * Delegates per-message composition to `<CopilotChatMessageView>` — the same
 * primitive CopilotChat uses internally. That component handles the full
 * generative-UI weave (text, reasoning, tool calls / useComponent / useRenderTool
 * renders, A2UI activity messages, MCP Apps activity messages, custom messages)
 * and emits a flat `messageElements` array via its children render prop, which
 * we drop into our own scroll container so the headless shell keeps layout
 * control.
 *
 * Our bubble styling is injected via the `userMessage` / `assistantMessage`
 * slots — see `user-bubble.tsx` and `assistant-bubble.tsx`.
 *
 * Canonical reference:
 *   packages/react-core/src/v2/components/chat/CopilotChatMessageView.tsx
 */
export function MessageList({
  messages,
  isRunning,
}: {
  messages: Message[];
  isRunning: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

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
      <CopilotChatMessageView
        messages={messages}
        isRunning={isRunning}
        // Cast to `any` mirrors the pattern used in the react-core slot tests
        // (e.g. CopilotChatMessageView.slots.e2e.test.tsx). The `typeof
        // CopilotChatAssistantMessage` slot type includes the component's
        // namespace-level static members (MarkdownRenderer, Toolbar, ...)
        // which a plain render function can't satisfy — the cast is purely
        // to appease the structural check; the slot receives the same props
        // at runtime.
        userMessage={UserBubble as any}
        assistantMessage={AssistantBubble as any}
      >
        {({ messageElements, isRunning: running, interruptElement }) => (
          <div className="space-y-3">
            {messageElements.length === 0 && (
              <div className="text-center text-sm text-gray-400 mt-8">
                Ask for a bar chart or a pie chart to see inline tool rendering.
              </div>
            )}
            {messageElements}
            {interruptElement}
            {running && <TypingIndicator />}
          </div>
        )}
      </CopilotChatMessageView>
    </div>
  );
}
