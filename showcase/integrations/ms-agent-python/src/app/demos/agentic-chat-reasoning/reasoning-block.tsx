"use client";

// Custom reasoning block renderer for the `think` tool.
//
// MS Agent Framework's AG-UI bridge doesn't currently emit
// REASONING_MESSAGE_* events, so we surface reasoning by having the agent
// call a `think(thought)` tool and rendering the tool call as a visible
// amber-tagged block matching the LangGraph reference's visual language.

import React from "react";

export function ReasoningBlock({
  args,
  status,
}: {
  args: { thought?: string };
  status?: string;
}) {
  const isStreaming = status !== "complete";
  const thought = args?.thought ?? "";
  const hasContent = thought.length > 0;

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
          {thought}
        </div>
      )}
    </div>
  );
}
