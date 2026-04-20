"use client";

import React from "react";
import { z } from "zod";

/**
 * Frontend-only component invoked by the agent as a tool call via
 * `useComponent({ name: "highlight_note", ... })`. The backend does
 * NOT define this tool — `useComponent` is sugar over
 * `useFrontendTool`, so the tool is registered against the frontend and
 * surfaces through the same `useRenderToolCall` path the manual hook
 * in `use-rendered-messages.tsx` is wired to.
 */
export const highlightNotePropsSchema = z.object({
  text: z.string().describe("The note text to highlight."),
  color: z
    .enum(["yellow", "pink", "green", "blue"])
    .describe("Highlight color for the note."),
});

export type HighlightNoteProps = z.infer<typeof highlightNotePropsSchema>;

const COLOR_CLASSES: Record<HighlightNoteProps["color"], string> = {
  yellow: "bg-yellow-100 border-yellow-300 text-yellow-900",
  pink: "bg-pink-100 border-pink-300 text-pink-900",
  green: "bg-green-100 border-green-300 text-green-900",
  blue: "bg-blue-100 border-blue-300 text-blue-900",
};

export function HighlightNote({ text, color }: HighlightNoteProps) {
  const cls = COLOR_CLASSES[color] ?? COLOR_CLASSES.yellow;
  return (
    <div
      className={`mt-2 mb-2 inline-block rounded-md border px-3 py-2 text-sm font-medium shadow-sm ${cls}`}
    >
      <span className="mr-2 text-xs uppercase tracking-wide opacity-70">
        Note
      </span>
      {text}
    </div>
  );
}
