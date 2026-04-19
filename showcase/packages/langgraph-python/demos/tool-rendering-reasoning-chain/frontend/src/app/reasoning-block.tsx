"use client";

// Amber reasoning banner for the `reasoningMessage` slot.
//
// Structurally identical to `agentic-chat-reasoning/.../reasoning-block.tsx`
// — duplicated here so the cell is self-contained (no cross-cell
// imports). The backend in this cell may emit MULTIPLE reasoning
// messages (one before each tool-calling step), so this component is
// rendered once per emitted ReasoningMessage.

import React from "react";
import type { ReasoningMessage, Message } from "@ag-ui/core";

export function ReasoningBlock({
  message,
  messages,
  isRunning,
}: {
  message: ReasoningMessage;
  messages?: Message[];
  isRunning?: boolean;
}) {
  const isLatest = messages?.[messages.length - 1]?.id === message.id;
  const isStreaming = !!(isRunning && isLatest);
  const hasContent = !!(message.content && message.content.length > 0);

  return (
    <div
      data-testid="reasoning-block"
      className="my-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-2 font-medium text-amber-800">
        <span className="inline-block rounded bg-amber-200 px-2 py-0.5 text-xs uppercase tracking-wider">
          Reasoning
        </span>
        <span>
          {isStreaming ? "Thinking…" : hasContent ? "Agent reasoning" : "…"}
        </span>
      </div>
      {hasContent && (
        <div className="mt-1 whitespace-pre-wrap italic text-amber-900/80">
          {message.content}
        </div>
      )}
    </div>
  );
}
