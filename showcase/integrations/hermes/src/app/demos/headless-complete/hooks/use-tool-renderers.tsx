"use client";

/**
 * Tool-call render registrations for the headless-complete demo.
 *
 * - `useRenderTool({ name: "get_weather" })`       → polished WeatherCard
 * - `useRenderTool({ name: "get_stock_price" })`   → polished StockCard
 * - `useRenderTool({ name: "get_revenue_chart" })` → polished ChartCard
 * - `useDefaultRenderTool` → wildcard fallback (GenericToolCard) used for
 *   any other tool the agent calls, including unknown MCP tools.
 *
 * 1:1 WITH langgraph-python: `get_weather`, `get_stock_price`, and
 * `get_revenue_chart` execute SERVER-SIDE in Hermes (the `hermes-showcase`
 * toolset — see integrations/hermes/showcase_tools.py). The client registers
 * them RENDER-ONLY via `useRenderTool` (no handler): the agent calls the
 * tool, Hermes runs the real handler and returns the result via AG-UI's
 * TOOL_CALL_RESULT, and the per-tool `render` paints the branded card.
 * (`highlight_note` remains a client `useComponent` tool — it is UI, not
 * data; see hooks/use-frontend-components.ts.)
 *
 * Registering renderers in a hook lets the demo's entry file enumerate
 * each capability with a single line per hook, which makes the
 * progressive-disclosure layout obvious to a reader.
 */

import React from "react";
import { z } from "zod";
import { useDefaultRenderTool, useRenderTool } from "@copilotkit/react-core/v2";
import { ChartCard, type ChartPoint } from "../tools/chart-card";
import { GenericToolCard } from "../tools/generic-tool-card";
import { StockCard } from "../tools/stock-card";
import { WeatherCard } from "../tools/weather-card";
import { parseJsonResult } from "../../_shared/parse-json-result";

interface WeatherResult {
  city?: string;
  temperature?: number;
  humidity?: number;
  wind_speed?: number;
  conditions?: string;
}

interface StockResult {
  ticker?: string;
  price_usd?: number;
  change_pct?: number;
}

interface RevenueResult {
  title?: string;
  subtitle?: string;
  data?: ChartPoint[];
}

export function useToolRenderers() {
  // Render-only (`useRenderTool`, no handler): the tools execute SERVER-SIDE
  // in Hermes and return their results via AG-UI's TOOL_CALL_RESULT.
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({ location: z.string() }),
      render: ({ parameters, result, status }) => {
        const r = parseJsonResult<WeatherResult>(result);
        return (
          <WeatherCard
            city={parameters?.location ?? r.city ?? ""}
            temperature={r.temperature}
            conditions={r.conditions}
            loading={status !== "complete"}
          />
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "get_stock_price",
      parameters: z.object({ ticker: z.string() }),
      render: ({ parameters, result, status }) => {
        const r = parseJsonResult<StockResult>(result);
        return (
          <StockCard
            ticker={parameters?.ticker ?? r.ticker ?? ""}
            price={r.price_usd}
            change={r.change_pct}
            loading={status !== "complete"}
          />
        );
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "get_revenue_chart",
      parameters: z.object({}),
      render: ({ result, status }) => {
        const r = parseJsonResult<RevenueResult>(result);
        return (
          <ChartCard
            title={r.title}
            subtitle={r.subtitle}
            data={r.data}
            loading={status !== "complete"}
          />
        );
      },
    },
    [],
  );

  useDefaultRenderTool(
    {
      render: ({ name, parameters, status, result }) => (
        <GenericToolCard
          name={name}
          parameters={parameters}
          status={status}
          result={result}
        />
      ),
    },
    [],
  );
}
