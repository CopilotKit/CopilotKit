"use client";

// Tool Rendering — REASONING CHAIN variant (.NET / Microsoft Agent Framework).
//
// A single cell that composes two previously-separate patterns:
//
//   1. Reasoning tokens rendered via a custom `reasoningMessage` slot —
//      the same approach used by the `agentic-chat-reasoning` cell. When
//      the backend emits reasoning content, the custom block is shown;
//      otherwise this degrades gracefully and only tool cards appear.
//   2. Sequential tool calls rendered with:
//        get_weather     → <WeatherCard />
//        search_flights  → <FlightListCard />
//        *               → <CustomCatchallRenderer />
//      mirroring the `tool-rendering` (primary) cell.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatReasoningMessage,
  useRenderTool,
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

interface WeatherResult {
  city?: string;
  temperature?: number;
  humidity?: number;
  wind_speed?: number;
  conditions?: string;
}

// The .NET SearchFlights tool emits an A2UI operations payload, whose
// `update_data_model` operation carries the flight list. We defensively
// reach into the payload to pull out a flat flight array for the simple
// FlightListCard UI — if the shape doesn't match we fall back to an
// empty list and the card just shows "no flights returned".
interface FlightSearchResult {
  a2ui_operations?: Array<{
    type?: string;
    data?: { flights?: Flight[] };
  }>;
}

function parseJsonResult<T>(result: unknown): T {
  if (!result) return {} as T;
  try {
    return (typeof result === "string" ? JSON.parse(result) : result) as T;
  } catch {
    return {} as T;
  }
}

function extractFlights(parsed: FlightSearchResult): Flight[] {
  if (!parsed?.a2ui_operations) return [];
  for (const op of parsed.a2ui_operations) {
    if (op?.type === "update_data_model" && op.data?.flights) {
      return op.data.flights;
    }
  }
  return [];
}

export default function ToolRenderingReasoningChainDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
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
        const flights = extractFlights(parsed);
        return (
          <FlightListCard
            loading={loading}
            origin={parameters?.origin ?? ""}
            destination={parameters?.destination ?? ""}
            flights={flights}
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
        message: "What's the weather in Tokyo? Then find flights from SFO.",
      },
      {
        title: "Flights + destination weather",
        message:
          "Find flights from SFO to JFK, then tell me the weather in New York.",
      },
      {
        title: "Weather in SF",
        message: "What's the weather in San Francisco?",
      },
      {
        title: "Sales pipeline",
        message: "Show me the current sales pipeline.",
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
