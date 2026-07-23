"use client";

// Custom `reasoningMessage` slot renderer for built-in-agent's
// reasoning chat demo. Surfaces the agent's chain-of-thought inline
// with a tagged amber banner so the thinking phase is always visible.

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
      className="my-2 rounded-xl border border-[#DBDBE5] bg-[#BEC2FF1A] px-3.5 py-2.5 text-sm"
    >
      <div className="flex items-center gap-2 font-medium text-[#010507]">
        <span className="inline-block rounded-full border border-[#BEC2FF] bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
          Reasoning
        </span>
        <span className="text-[#57575B]">
          {isStreaming ? "Thinking…" : hasContent ? "Agent reasoning" : "…"}
        </span>
      </div>
      {hasContent && (
        <div className="mt-1.5 whitespace-pre-wrap italic text-[#57575B]">
          {message.content}
        </div>
      )}
    </div>
  );
}
