"use client";

import React from "react";
import { useRenderTool, useDefaultRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { WeatherCard } from "./weather-card";
import { FlightListCard, type Flight } from "./flight-list-card";
import { StockCard } from "./stock-card";
import { D20Card } from "./d20-card";
import {
  CustomCatchallRenderer,
  type CatchallToolStatus,
} from "./custom-catchall-renderer";

interface WeatherResult {
  city?: string;
  temperature?: number;
  humidity?: number;
  wind_speed?: number;
  conditions?: string;
}

interface FlightSearchResult {
  origin?: string;
  destination?: string;
  flights?: Flight[];
}

interface StockResult {
  ticker?: string;
  price_usd?: number;
  change_pct?: number;
}

interface D20Result {
  value?: number;
  result?: number;
  sides?: number;
}

/**
 * Central registration hook for tool-call rendering surfaces in the
 * built-in-agent `tool-rendering` cell. Mirrors the LGP cell at
 * `langgraph-python/src/app/demos/tool-rendering/page.tsx`:
 *
 *   - get_weather     → WeatherCard
 *   - search_flights  → FlightListCard
 *   - get_stock_price → StockCard
 *   - roll_d20        → D20Card
 *   - *               → CustomCatchallRenderer (wildcard fallback)
 */
export function useToolRenderingRenderers() {
  // Per-tool renderer #1: get_weather → branded WeatherCard.
  // @region[render-weather-tool]
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({
        location: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<WeatherResult>(result);
        return (
          <WeatherCard
            loading={loading}
            location={parameters?.location ?? parsed.city ?? ""}
            temperature={parsed.temperature}
            humidity={parsed.humidity}
            windSpeed={parsed.wind_speed}
            conditions={parsed.conditions}
          />
        );
      },
    },
    [],
  );
  // @endregion[render-weather-tool]

  // Per-tool renderer #2: search_flights → branded FlightListCard.
  // @region[render-flight-tool]
  useRenderTool(
    {
      name: "search_flights",
      parameters: z.object({
        origin: z.string(),
        destination: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<FlightSearchResult>(result);
        return (
          <FlightListCard
            loading={loading}
            origin={parameters?.origin ?? parsed.origin ?? ""}
            destination={parameters?.destination ?? parsed.destination ?? ""}
            flights={parsed.flights ?? []}
          />
        );
      },
    },
    [],
  );
  // @endregion[render-flight-tool]

  // Per-tool renderer #3: get_stock_price → branded StockCard.
  useRenderTool(
    {
      name: "get_stock_price",
      parameters: z.object({
        ticker: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<StockResult>(result);
        return (
          <StockCard
            loading={loading}
            ticker={parameters?.ticker ?? parsed.ticker ?? ""}
            priceUsd={parsed.price_usd}
            changePct={parsed.change_pct}
          />
        );
      },
    },
    [],
  );

  // Per-tool renderer #4: roll_d20 → branded D20Card. Each tool call
  // mounts its own card so e2e tests can count them.
  useRenderTool(
    {
      name: "roll_d20",
      parameters: z.object({
        value: z.number().optional(),
      }),
      render: ({ result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<D20Result>(result);
        const value =
          typeof parsed.value === "number"
            ? parsed.value
            : typeof parsed.result === "number"
              ? parsed.result
              : undefined;
        return <D20Card loading={loading} value={value} />;
      },
    },
    [],
  );

  // @region[catchall-renderer]
  // Wildcard catch-all for anything that doesn't match a per-tool
  // renderer above.
  useDefaultRenderTool(
    {
      render: ({ name, parameters, status, result }) => (
        <CustomCatchallRenderer
          name={name}
          parameters={parameters}
          status={status as CatchallToolStatus}
          result={result}
        />
      ),
    },
    [],
  );
  // @endregion[catchall-renderer]
}

function parseJsonResult<T>(result: unknown): T {
  if (!result) return {} as T;
  try {
    return (typeof result === "string" ? JSON.parse(result) : result) as T;
  } catch {
    return {} as T;
  }
}
