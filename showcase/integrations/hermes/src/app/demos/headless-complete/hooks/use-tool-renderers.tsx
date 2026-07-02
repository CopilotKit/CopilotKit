"use client";

/**
 * Tool-call render registrations for the headless-complete demo.
 *
 * - `useFrontendTool({ name: "get_weather" })`       → polished WeatherCard
 * - `useFrontendTool({ name: "get_stock_price" })`   → polished StockCard
 * - `useFrontendTool({ name: "get_revenue_chart" })` → polished ChartCard
 * - `useDefaultRenderTool` → wildcard fallback (GenericToolCard) used for
 *   any other tool the agent calls, including unknown MCP tools.
 *
 * DIVERGENCE FROM langgraph-python: langgraph runs `get_weather`,
 * `get_stock_price`, and `get_revenue_chart` as BACKEND tools (registered
 * render-only via `useRenderTool`; the graph executes them). Hermes has no
 * backend tool execution and the D5 aimock harness does not run real
 * tools — so, exactly like the green `tool-rendering` demo, each tool is a
 * CLIENT-EXECUTED frontend tool: `useFrontendTool` registers the tool
 * name + schema + a DETERMINISTIC fake-data handler that mirrors the
 * langgraph backend return shape 1:1, plus the per-tool `render` that
 * paints the branded card. The aimock fixture makes the agent EMIT the
 * tool call; the client handler returns the data via the AG-UI round-trip;
 * the renderer paints the card.
 *
 * Registering renderers in a hook lets the demo's entry file enumerate
 * each capability with a single line per hook, which makes the
 * progressive-disclosure layout obvious to a reader.
 */

import React from "react";
import { z } from "zod";
import {
  useDefaultRenderTool,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
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

// Deterministic fake-data handlers. Mirror the langgraph backend tool
// return shapes 1:1 so the shared cards + e2e assertions hold.
function weatherData(location: string): WeatherResult {
  return {
    city: location,
    temperature: 68,
    humidity: 55,
    wind_speed: 10,
    conditions: "Sunny",
  };
}

function stockData(ticker: string): StockResult {
  return {
    ticker: (ticker || "").toUpperCase(),
    price_usd: 189.42,
    change_pct: 1.27,
  };
}

function revenueData(): RevenueResult {
  return {
    title: "Quarterly revenue",
    subtitle: "Last six months · USD thousands",
    data: [
      { label: "Jan", value: 38 },
      { label: "Feb", value: 47 },
      { label: "Mar", value: 52 },
      { label: "Apr", value: 49 },
      { label: "May", value: 63 },
      { label: "Jun", value: 71 },
    ],
  };
}

export function useToolRenderers() {
  useFrontendTool(
    {
      name: "get_weather",
      description: "Get the current weather for a given location.",
      parameters: z.object({ location: z.string() }),
      handler: async ({ location }: { location: string }) =>
        weatherData(location),
      render: ({ args, result, status }) => {
        const r = parseJsonResult<WeatherResult>(result);
        return (
          <WeatherCard
            city={args?.location ?? r.city ?? ""}
            temperature={r.temperature}
            conditions={r.conditions}
            loading={status !== "complete"}
          />
        );
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "get_stock_price",
      description: "Get a mock current price for a stock ticker.",
      parameters: z.object({ ticker: z.string() }),
      handler: async ({ ticker }: { ticker: string }) => stockData(ticker),
      render: ({ args, result, status }) => {
        const r = parseJsonResult<StockResult>(result);
        return (
          <StockCard
            ticker={args?.ticker ?? r.ticker ?? ""}
            price={r.price_usd}
            change={r.change_pct}
            loading={status !== "complete"}
          />
        );
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "get_revenue_chart",
      description:
        "Get a mock six-month revenue series for a chart visualization.",
      parameters: z.object({}),
      handler: async () => revenueData(),
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
