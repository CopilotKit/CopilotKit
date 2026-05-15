"use client";

// Tool Rendering — REASONING CHAIN variant.
//
// Combines a custom `reasoningMessage` slot (extended-thinking via Claude
// 3.7 Sonnet) with sequential tool calls rendered as:
//   get_weather     → <WeatherCard />
//   search_flights  → <FlightListCard />
//   *               → <CustomCatchallRenderer />
//
// Tools are exposed via `useFrontendTool` with stub handlers so the Claude
// Agent SDK pass-through can call them.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatReasoningMessage,
  useRenderTool,
  useDefaultRenderTool,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ReasoningBlock } from "./reasoning-block";
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

export default function ToolRenderingReasoningChainDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-reasoning"
      agent="tool-rendering-reasoning-chain"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useFrontendTool({
    name: "get_weather",
    description: "Get the current weather for a given location.",
    parameters: z.object({ location: z.string() }),
    handler: async ({ location }: { location: string }) => ({
      city: location,
      temperature: 68,
      humidity: 55,
      wind_speed: 10,
      conditions: "Sunny",
    }),
  });

  useFrontendTool({
    name: "search_flights",
    description: "Search mock flights between two airports.",
    parameters: z.object({
      origin: z.string(),
      destination: z.string(),
    }),
    handler: async ({
      origin,
      destination,
    }: {
      origin: string;
      destination: string;
    }) => ({
      origin,
      destination,
      flights: [
        {
          airline: "United",
          flight: "UA231",
          depart: "08:15",
          arrive: "16:45",
          price_usd: 348,
        },
        {
          airline: "Delta",
          flight: "DL412",
          depart: "11:20",
          arrive: "19:55",
          price_usd: 312,
        },
        {
          airline: "JetBlue",
          flight: "B6722",
          depart: "17:05",
          arrive: "01:30",
          price_usd: 289,
        },
      ],
    }),
  });

  useFrontendTool({
    name: "get_stock_price",
    description: "Get a mock current price for a stock ticker.",
    parameters: z.object({ ticker: z.string() }),
    handler: async ({ ticker }: { ticker: string }) => ({
      ticker: ticker.toUpperCase(),
      price_usd: 187.42,
      change_pct: 1.32,
    }),
  });

  useFrontendTool({
    name: "roll_dice",
    description: "Roll a single die with the given number of sides.",
    parameters: z.object({ sides: z.number().default(6) }),
    handler: async ({ sides }: { sides: number }) => ({
      sides,
      result: Math.max(1, Math.floor(Math.random() * Math.max(2, sides)) + 1),
    }),
  });

  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({ location: z.string() }),
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
        title: "Weather + flights to Tokyo",
        message: "What's the weather in Tokyo?",
      },
      { title: "Compare two stocks", message: "How is AAPL doing?" },
      { title: "Chain of dice rolls", message: "Roll a 20-sided die for me." },
      {
        title: "Flights + destination weather",
        message: "Find flights from SFO to JFK.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="tool-rendering-reasoning-chain"
      className="h-full rounded-2xl"
      messageView={{
        reasoningMessage: ReasoningBlock as typeof CopilotChatReasoningMessage,
      }}
    />
  );
}
