"use client";

// Tool Rendering — REASONING CHAIN variant (Hermes).
//
// A single cell that COMBINES two proven Hermes mechanisms:
//
//   1. Reasoning tokens rendered via a custom `reasoningMessage` slot —
//      the same approach used by the `reasoning-custom` cell. This demo
//      routes to the dedicated `/api/copilotkit-reasoning` runtime (the
//      second Hermes AG-UI backend on :8001 running gpt-5-mini) so aimock
//      streams `reasoning_content` and the adapter emits
//      REASONING_MESSAGE_* events. The main :8000 backend runs gpt-4o,
//      which aimock treats as non-reasoning (no reasoning stream).
//   2. Sequential CLIENT-EXECUTED tool calls (`useFrontendTool` with
//      deterministic fake-data handlers) rendered with:
//        get_weather     → <WeatherCard />              (per-tool renderer)
//        search_flights  → <FlightListCard />           (per-tool renderer)
//        get_stock_price → <CustomCatchallRenderer />   (wildcard fallback)
//        roll_dice       → <CustomCatchallRenderer />   (wildcard fallback)
//      mirroring the green `tool-rendering` (primary) cell.
//
// Hermes has no backend get_weather/search_flights/… tools, so — exactly
// like the green tool-rendering / frontend-tools demos — each tool is a
// CLIENT-EXECUTED frontend tool: `useFrontendTool` registers the tool
// name + schema + a deterministic fake-data handler. The aimock fixture
// (with `reasoning` on the tool-emitting legs) makes the agent EMIT the
// tool call AND stream reasoning; the client handler returns deterministic
// data via the AG-UI round-trip; the renderer paints the card.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatReasoningMessage,
  useFrontendTool,
  useDefaultRenderTool,
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
import { parseJsonResult } from "../_shared/parse-json-result";

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

interface DiceResult {
  sides?: number;
  value?: number;
  result?: number;
}

// Deterministic fake-data handlers. Mirror the tool-emitting fixture
// arguments 1:1 so the shared cards + e2e assertions hold. The fixture
// passes the observable values (price_usd, change_pct, sides) as tool
// arguments; the handler echoes them into the result the renderer reads.
function weatherData(location: string): WeatherResult {
  return {
    city: location,
    temperature: 68,
    humidity: 55,
    wind_speed: 10,
    conditions: "Sunny",
  };
}

function flightsData(origin: string, destination: string): FlightSearchResult {
  return {
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
  };
}

function stockData(
  ticker: string,
  price_usd?: number,
  change_pct?: number,
): StockResult {
  return {
    ticker: (ticker || "").toUpperCase(),
    price_usd:
      price_usd !== undefined ? Math.round(price_usd * 100) / 100 : 189.42,
    change_pct:
      change_pct !== undefined ? Math.round(change_pct * 100) / 100 : 1.27,
  };
}

function diceData(sides?: number): DiceResult {
  const s = typeof sides === "number" && sides >= 2 ? sides : 6;
  const rolled = Math.max(1, Math.min(s, Math.floor(s / 2) || 1));
  return { sides: s, value: rolled, result: rolled };
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
  // Per-tool renderer #1: get_weather → branded WeatherCard.
  useFrontendTool(
    {
      name: "get_weather",
      description: "Get the current weather for a given location.",
      parameters: z.object({ location: z.string() }),
      handler: async ({ location }: { location: string }) =>
        weatherData(location),
      render: ({ args, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<WeatherResult>(result);
        return (
          <WeatherCard
            loading={loading}
            location={args?.location ?? parsed.city ?? ""}
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
  useFrontendTool(
    {
      name: "search_flights",
      description:
        "Search mock flights from an origin airport to a destination airport.",
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
      }) => flightsData(origin, destination),
      render: ({ args, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<FlightSearchResult>(result);
        return (
          <FlightListCard
            loading={loading}
            origin={args?.origin ?? parsed.origin ?? ""}
            destination={args?.destination ?? parsed.destination ?? ""}
            flights={parsed.flights ?? []}
          />
        );
      },
    },
    [],
  );

  // Client-executed tool #3: get_stock_price. NO per-tool render, so it
  // falls through to the catch-all below (mirrors the langgraph
  // reasoning-chain, where stocks paint via the catchall renderer).
  useFrontendTool(
    {
      name: "get_stock_price",
      description: "Get a mock current price for a stock ticker.",
      parameters: z.object({
        ticker: z.string(),
        price_usd: z.number().optional(),
        change_pct: z.number().optional(),
      }),
      handler: async ({
        ticker,
        price_usd,
        change_pct,
      }: {
        ticker: string;
        price_usd?: number;
        change_pct?: number;
      }) => stockData(ticker, price_usd, change_pct),
    },
    [],
  );

  // Client-executed tool #4: roll_dice. NO per-tool render → catch-all.
  useFrontendTool(
    {
      name: "roll_dice",
      description: "Roll an N-sided die.",
      parameters: z.object({
        sides: z.number().optional(),
      }),
      handler: async ({ sides }: { sides?: number }) => diceData(sides),
    },
    [],
  );

  // Wildcard catch-all for anything that doesn't match a per-tool
  // renderer above (get_stock_price, roll_dice).
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
        title: "Compare two stocks",
        message: "Compare AAPL and MSFT stocks for me.",
      },
      {
        title: "Chain of dice rolls",
        message: "Roll a 20-sided die for me and compare it to a smaller one.",
      },
      {
        title: "Flights + destination weather",
        message: "Find flights from SFO to JFK and show me the weather there.",
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
