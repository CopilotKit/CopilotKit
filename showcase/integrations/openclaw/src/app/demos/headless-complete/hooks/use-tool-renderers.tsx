"use client";

/**
 * Tool registrations for the headless-complete demo.
 *
 * - `useFrontendTool({ name: "get_weather" })`       → mock data + WeatherCard
 * - `useFrontendTool({ name: "get_stock_price" })`   → mock data + StockCard
 * - `useFrontendTool({ name: "get_revenue_chart" })` → mock data + ChartCard
 * - `useDefaultRenderTool` → wildcard fallback (GenericToolCard) used for any
 *   other tool the agent calls, including unknown MCP tools.
 *
 * In the claude-sdk reference these were BACKEND tools (the agent_server
 * computed the data and the frontend only rendered it via `useRenderTool`).
 * OpenClaw's gateway is a pass-through with no per-demo backend tools, so we
 * forward them from the frontend via `useFrontendTool` instead: the handler
 * produces the (demo) data — which becomes the tool result the agent sees —
 * and `render` draws the same polished card. This is the same forward-the-tool
 * pattern the other OpenClaw gen-ui demos use.
 *
 * Registering each tool in a hook lets the demo's entry file enumerate every
 * capability with a single line per hook, keeping the progressive-disclosure
 * layout obvious to a reader.
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

// Deterministic demo data derived from the tool arguments — stands in for the
// backend the claude-sdk reference had. Enough variety to feel live without a
// real data source.
function mockWeather(location: string) {
  const conditions = ["Sunny", "Partly cloudy", "Light rain", "Clear"];
  const seed = [...location].reduce((n, c) => n + c.charCodeAt(0), 0);
  return {
    city: location,
    temperature: 12 + (seed % 20),
    conditions: conditions[seed % conditions.length],
  };
}

function mockStock(ticker: string) {
  const seed = [...ticker.toUpperCase()].reduce(
    (n, c) => n + c.charCodeAt(0),
    0,
  );
  const change = ((seed % 800) - 400) / 100; // -4.00 .. +3.99
  return {
    ticker: ticker.toUpperCase(),
    price_usd: 50 + (seed % 400) + 0.5,
    change_pct: Number(change.toFixed(2)),
  };
}

const REVENUE_CHART = {
  title: "Quarterly Revenue",
  subtitle: "FY2026 ($M)",
  data: [
    { label: "Q1", value: 42 },
    { label: "Q2", value: 58 },
    { label: "Q3", value: 71 },
    { label: "Q4", value: 86 },
  ] as ChartPoint[],
};

export function useToolRenderers() {
  useFrontendTool(
    {
      name: "get_weather",
      description: "Get the current weather for a location.",
      parameters: z.object({ location: z.string() }),
      handler: async ({ location }) => mockWeather(location),
      render: ({ parameters, result, status }) => {
        const r = parseJson<{
          city: string;
          temperature: number;
          conditions: string;
        }>(result);
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

  useFrontendTool(
    {
      name: "get_stock_price",
      description: "Get the latest price for a stock ticker.",
      parameters: z.object({ ticker: z.string() }),
      handler: async ({ ticker }) => mockStock(ticker),
      render: ({ parameters, result, status }) => {
        const r = parseJson<{
          ticker: string;
          price_usd: number;
          change_pct: number;
        }>(result);
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

  useFrontendTool(
    {
      name: "get_revenue_chart",
      description: "Show a chart of quarterly revenue.",
      parameters: z.object({}),
      handler: async () => REVENUE_CHART,
      render: ({ result, status }) => {
        const r = parseJson<{
          title: string;
          subtitle: string;
          data: ChartPoint[];
        }>(result);
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

function parseJson<T>(raw: unknown): Partial<T> {
  if (!raw) return {};
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<T>;
  } catch {
    return {};
  }
}
