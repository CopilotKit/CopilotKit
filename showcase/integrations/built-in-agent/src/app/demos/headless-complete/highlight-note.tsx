"use client";

import React from "react";
import { z } from "zod";

/**
 * Frontend-only component invoked by the agent as a tool call via
 * `useComponent({ name: "highlight_note", ... })`. The backend does
 * NOT define this tool — `useComponent` is sugar over
 * `useFrontendTool`, so the tool is registered against the frontend.
 */
export const highlightNotePropsSchema = z.object({
  text: z.string().describe("The note text to highlight."),
  color: z
    .enum(["yellow", "pink", "green", "blue"])
    .describe("Highlight color for the note."),
});

export type HighlightNoteProps = z.infer<typeof highlightNotePropsSchema>;

const COLOR_CLASSES: Record<HighlightNoteProps["color"], string> = {
  yellow: "bg-[#FFF388]/30 border-[#FFF388] text-[#010507]",
  pink: "bg-[#FA5F67]/10 border-[#FA5F6733] text-[#010507]",
  green: "bg-[#85ECCE]/20 border-[#85ECCE4D] text-[#010507]",
  blue: "bg-[#BEC2FF1A] border-[#BEC2FF] text-[#010507]",
};

export function HighlightNote({ text, color }: HighlightNoteProps) {
  const cls = COLOR_CLASSES[color] ?? COLOR_CLASSES.yellow;
  return (
    <div
      className={`mt-2 mb-2 inline-block rounded-xl border px-3 py-2 text-sm font-medium shadow-sm ${cls}`}
    >
      <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
        Note
      </span>
      {text}
    </div>
  );
}
