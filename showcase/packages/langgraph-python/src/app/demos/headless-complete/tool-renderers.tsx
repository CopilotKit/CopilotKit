"use client";

import React from "react";
import {
  useRenderTool,
  useDefaultRenderTool,
  useComponent,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { WeatherCard } from "./weather-card";
import { StockCard } from "./stock-card";
import { HighlightNote, highlightNotePropsSchema } from "./highlight-note";

/**
 * Central registration hook for every tool-call rendering surface
 * exercised by the headless-complete cell:
 *
 *   - `useRenderTool({ name: "get_weather", ... })` — per-tool renderer
 *     for the backend weather tool (blue card).
 *   - `useRenderTool({ name: "get_stock_price", ... })` — per-tool
 *     renderer for the backend stock tool (gray card, green/red delta).
 *   - `useComponent({ name: "highlight_note", ... })` — frontend-only
 *     tool the agent can invoke; renders the `HighlightNote` component
 *     inline through the same `useRenderToolCall` path.
 *   - `useDefaultRenderTool(...)` — wildcard catch-all so any other
 *     tool the agent might call (e.g. the Excalidraw MCP tools) still
 *     gets a visible card even though the headless cell composes its
 *     own message view.
 *
 * MCP Apps activity surfaces are NOT routed through this registry —
 * they come in as `activity` messages and are rendered by
 * `useRenderActivityMessage` (already consumed in
 * `use-rendered-messages.tsx`).
 */
export function useHeadlessCompleteToolRenderers() {
  // Per-tool renderer #1: backend `get_weather` -> branded WeatherCard.
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({
        location: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<{
          city?: string;
          temperature?: number;
          conditions?: string;
        }>(result);
        return (
          <WeatherCard
            loading={loading}
            location={parameters?.location ?? parsed.city ?? ""}
            temperature={parsed.temperature}
            conditions={parsed.conditions}
          />
        );
      },
    },
    [],
  );

  // Per-tool renderer #2: backend `get_stock_price` -> branded StockCard.
  useRenderTool(
    {
      name: "get_stock_price",
      parameters: z.object({
        ticker: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<{
          ticker?: string;
          price_usd?: number;
          change_pct?: number;
        }>(result);
        return (
          <StockCard
            loading={loading}
            ticker={parameters?.ticker ?? parsed.ticker ?? ""}
            price={parsed.price_usd}
            changePct={parsed.change_pct}
          />
        );
      },
    },
    [],
  );

  // Frontend-registered tool the agent can invoke. `useComponent` is
  // sugar over `useFrontendTool`, so the registration flows through
  // the same `useRenderToolCall` path the manual hook consumes.
  useComponent({
    name: "highlight_note",
    description:
      "Highlight a short note or phrase inline in the chat with a colored card. Use this whenever the user asks to highlight, flag, or mark a snippet of text.",
    parameters: highlightNotePropsSchema,
    render: HighlightNote,
  });

  // Wildcard catch-all for tools without a bespoke renderer (e.g. any
  // Excalidraw MCP tools surfaced as regular tool calls alongside the
  // MCP Apps activity).
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
