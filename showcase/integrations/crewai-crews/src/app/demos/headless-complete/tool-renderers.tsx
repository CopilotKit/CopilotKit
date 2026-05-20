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

export function useHeadlessCompleteToolRenderers() {
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

  useComponent({
    name: "highlight_note",
    description:
      "Highlight a short note or phrase inline in the chat with a colored card. Use this whenever the user asks to highlight, flag, or mark a snippet of text.",
    parameters: highlightNotePropsSchema,
    render: HighlightNote,
  });

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
