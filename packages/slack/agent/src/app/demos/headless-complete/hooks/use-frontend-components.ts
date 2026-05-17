"use client";

/**
 * Frontend tool registration for the headless-complete demo.
 *
 * `useComponent` exposes a UI-only "tool" the agent can invoke. The agent
 * sends `{ text, color }` and the registered component is rendered
 * directly inline as the assistant's "result". Used here for the
 * `highlight_note` generative-UI tool — a sticky-note style card.
 */

import { useComponent } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { HighlightNote } from "../tools/highlight-note";

export function useFrontendComponents() {
  useComponent({
    name: "highlight_note",
    description:
      "Highlight a short note in a chosen color (yellow, pink, green, blue).",
    parameters: z.object({
      text: z.string(),
      color: z.enum(["yellow", "pink", "green", "blue"]),
    }),
    render: HighlightNote,
  });
}
