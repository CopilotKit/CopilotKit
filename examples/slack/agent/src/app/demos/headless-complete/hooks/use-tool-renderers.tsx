"use client";

/**
 * Tool-call render registrations for the headless-complete demo.
 *
 * - `useRenderTool({ name: "get_weather" })`        → polished WeatherCard
 * - `useRenderTool({ name: "get_stock_price" })`    → polished StockCard
 * - `useRenderTool({ name: "get_revenue_chart" })`  → polished ChartCard
 * - `useDefaultRenderTool` → wildcard fallback (GenericToolCard) used for
 *   any other backend tool the agent calls, including unknown MCP tools.
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

export function useToolRenderers() {
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({ location: z.string() }),
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

  useRenderTool(
    {
      name: "get_stock_price",
      parameters: z.object({ ticker: z.string() }),
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

  useRenderTool(
    {
      name: "get_revenue_chart",
      parameters: z.object({}),
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
