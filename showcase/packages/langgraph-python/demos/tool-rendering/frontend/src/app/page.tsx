"use client";

// Tool Rendering — PRIMARY (per-tool + catch-all) variant.
//
// The most sophisticated point in the three-way progression: the same
// backend tools as the `tool-rendering-default-catchall` and
// `tool-rendering-custom-catchall` cells are now surfaced via
// dedicated, branded UI for the two "interesting" tools, with a
// catch-all covering everything else:
//
//   get_weather     → <WeatherCard />       (per-tool renderer)
//   search_flights  → <FlightListCard />    (per-tool renderer)
//   *               → <CustomCatchallRenderer /> (wildcard fallback)

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useRenderTool,
  useDefaultRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { WeatherCard } from "./weather-card";
import { FlightListCard, type Flight } from "./flight-list-card";
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

function parseJsonResult<T>(result: unknown): T {
  if (!result) return {} as T;
  try {
    return (typeof result === "string" ? JSON.parse(result) : result) as T;
  } catch {
    return {} as T;
  }
}

export default function ToolRenderingDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="tool-rendering">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // Per-tool renderer #1: get_weather → branded WeatherCard.
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

  // Per-tool renderer #2: search_flights → branded FlightListCard.
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

  // Wildcard catch-all for every remaining tool (get_stock_price,
  // roll_dice, anything the agent might add later).
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

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in SF",
        message: "What's the weather in San Francisco?",
      },
      {
        title: "Find flights",
        message: "Find flights from SFO to JFK.",
      },
      {
        title: "Stock price",
        message: "What's the current price of AAPL?",
      },
      {
        title: "Roll a d20",
        message: "Roll a 20-sided die.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat agentId="tool-rendering" className="h-full rounded-2xl" />
  );
}
