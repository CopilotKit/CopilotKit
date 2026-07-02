"use client";

// Tool Rendering — PRIMARY (per-tool + catch-all) variant.
//
// The most sophisticated point in the three-way progression: every
// "interesting" tool gets its own dedicated, branded UI, and a
// catch-all paints anything that slips through.
//
//   get_weather     → <WeatherCard />       (per-tool renderer)
//   search_flights  → <FlightListCard />    (per-tool renderer)
//   get_stock_price → <StockCard />         (per-tool renderer)
//   roll_d20        → <D20Card />           (per-tool renderer)
//   *               → <CustomCatchallRenderer /> (wildcard fallback)
//
// Hermes has no backend get_weather/search_flights/… tools, and the D5
// aimock harness does not execute real tools. So — exactly like the
// green frontend-tools / gen-ui-tool-based demos — each tool is a
// CLIENT-EXECUTED frontend tool: `useFrontendTool` registers the tool
// name + schema + a deterministic fake-data handler, AND a per-tool
// `render` that paints the branded card. The aimock fixture makes the
// agent EMIT the tool call; the client handler returns deterministic
// data via the AG-UI round-trip; the renderer paints the card.

// @region[render-flight-tool]
// @region[render-weather-tool]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { WeatherCard } from "./weather-card";
import { FlightListCard, type Flight } from "./flight-list-card";
import { StockCard } from "./stock-card";
import { D20Card } from "./d20-card";
import {
  CustomCatchallRenderer,
  type CatchallToolStatus,
} from "./custom-catchall-renderer";
import { parseJsonResult } from "../_shared/parse-json-result";
import { useSuggestions } from "./suggestions";

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

function d20Data(value?: number): D20Result {
  const rolled =
    typeof value === "number" && value >= 1 && value <= 20 ? value : 11;
  return { sides: 20, value: rolled, result: rolled };
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
  useFrontendTool(
    {
      name: "get_weather",
      description: "Get the current weather for a given location.",
      parameters: z.object({
        location: z.string(),
      }),
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
  // @endregion[render-weather-tool]

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
  // @endregion[render-flight-tool]

  // Per-tool renderer #3: get_stock_price → branded StockCard.
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
      render: ({ args, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<StockResult>(result);
        return (
          <StockCard
            loading={loading}
            ticker={args?.ticker ?? parsed.ticker ?? ""}
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
  useFrontendTool(
    {
      name: "roll_d20",
      description: "Roll a 20-sided die.",
      parameters: z.object({
        value: z.number().optional(),
      }),
      handler: async ({ value }: { value?: number }) => d20Data(value),
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

  useSuggestions();

  return (
    <CopilotChat agentId="tool-rendering" className="h-full rounded-2xl" />
  );
}
