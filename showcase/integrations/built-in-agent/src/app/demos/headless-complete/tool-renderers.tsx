"use client";

import React from "react";
import {
  useRenderTool,
  useDefaultRenderTool,
  useComponent,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { WeatherCard } from "./weather-card";
import { HaikuCard } from "./haiku-card";
import { HighlightNote, highlightNotePropsSchema } from "./highlight-note";

/**
 * Central registration hook for tool-call rendering surfaces in the
 * headless-complete cell.
 *
 *   - `useRenderTool({ name: "weather", ... })` — backend weather tool
 *     (built-in-agent's `weather` server tool) -> blue card.
 *   - `useRenderTool({ name: "haiku", ... })` — backend haiku tool ->
 *     branded card.
 *   - `useComponent({ name: "highlight_note", ... })` — frontend-only
 *     tool the agent can invoke via the same useRenderToolCall path.
 *   - `useDefaultRenderTool()` — wildcard catch-all for any other tool.
 */
export function useHeadlessCompleteToolRenderers() {
  // Per-tool renderer #1: backend `weather` -> branded WeatherCard.
  useRenderTool(
    {
      name: "weather",
      parameters: z.object({
        city: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<{
          city?: string;
          tempF?: number;
          condition?: string;
        }>(result);
        return (
          <WeatherCard
            loading={loading}
            location={parameters?.city ?? parsed.city ?? ""}
            temperature={parsed.tempF}
            conditions={parsed.condition}
          />
        );
      },
    },
    [],
  );

  // Per-tool renderer #2: backend `haiku` -> branded HaikuCard.
  useRenderTool(
    {
      name: "haiku",
      parameters: z.object({
        topic: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<{
          topic?: string;
          lines?: string[];
        }>(result);
        return (
          <HaikuCard
            loading={loading}
            topic={parameters?.topic ?? parsed.topic ?? ""}
            lines={parsed.lines}
          />
        );
      },
    },
    [],
  );

  // Frontend-registered tool the agent can invoke. `useComponent` is
  // sugar over `useFrontendTool`.
  useComponent({
    name: "highlight_note",
    description:
      "Highlight a short note or phrase inline in the chat with a colored card. Use this whenever the user asks to highlight, flag, or mark a snippet of text.",
    parameters: highlightNotePropsSchema,
    render: HighlightNote,
  });

  // Wildcard catch-all for tools without a bespoke renderer.
  useDefaultRenderTool();
}

function parseJsonResult<T>(result: unknown): T {
  if (!result) return {} as T;
  try {
    return (typeof result === "string" ? JSON.parse(result) : result) as T;
  } catch {
    return {} as T;
  }
}
