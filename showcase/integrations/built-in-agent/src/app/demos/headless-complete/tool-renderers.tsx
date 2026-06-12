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
import { StockCard } from "./stock-card";
import { ChartCard, type ChartPoint } from "./chart-card";

/**
 * Central registration hook for tool-call rendering surfaces in the
 * headless-complete cell.
 *
 *   - `useRenderTool({ name: "get_weather", ... })` — backend weather tool
 *     (built-in-agent's `get_weather` server tool) -> blue card.
 *   - `useRenderTool({ name: "haiku", ... })` — backend haiku tool ->
 *     branded card.
 *   - `useRenderTool({ name: "get_stock_price", ... })` — backend stock
 *     price tool -> branded StockCard.
 *   - `useRenderTool({ name: "get_revenue_chart", ... })` — backend
 *     revenue chart tool -> branded ChartCard (recharts).
 *   - `useComponent({ name: "highlight_note", ... })` — frontend-only
 *     tool the agent can invoke via the same useRenderToolCall path.
 *   - `useDefaultRenderTool()` — wildcard catch-all for any other tool.
 */
export function useHeadlessCompleteToolRenderers() {
  // Per-tool renderer #1: backend `get_weather` -> branded WeatherCard.
  useRenderTool(
    {
      name: "get_weather",
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

  // Per-tool renderer #3: backend `get_stock_price` -> branded StockCard.
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

  // Per-tool renderer #4: backend `get_revenue_chart` -> branded ChartCard.
  useRenderTool(
    {
      name: "get_revenue_chart",
      parameters: z.object({}),
      render: ({ result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<{
          title?: string;
          subtitle?: string;
          data?: ChartPoint[];
        }>(result);
        return (
          <ChartCard
            loading={loading}
            title={parsed.title}
            subtitle={parsed.subtitle}
            data={parsed.data}
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
