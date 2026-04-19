"use client";

import React from "react";
import type { UserMessage } from "@ag-ui/core";

/**
 * Right-aligned user bubble.
 *
 * This is the `userMessage` slot passed to `<CopilotChatMessageView>`. Kept
 * headless/minimal (no attachments UI) — renders only the text parts of the
 * user message. If richer rendering is needed, you can swap in the default
 * `<CopilotChatUserMessage>` from `@copilotkit/react-core/v2`.
 */
export function UserBubble({ message }: { message: UserMessage }) {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((p) => (p.type === "text" ? p.text : "")).join("")
        : "";
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-blue-600 text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  );
}
