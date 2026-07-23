"use client";

// Tool Rendering — REASONING CHAIN variant.
//
// A single cell that composes two previously-separate patterns:
//
//   1. Reasoning tokens rendered via a custom `reasoningMessage` slot —
//      the same approach used by the `reasoning-custom` cell.
//   2. Sequential tool calls rendered with:
//        get_weather     → <WeatherCard />
//        search_flights  → <FlightListCard />
//        *               → <CustomCatchallRenderer />
//      mirroring the `tool-rendering` (primary) cell.

import React from "react";
import type { CopilotChatReasoningMessage } from "@copilotkit/react-core/v2";
import {
  CopilotKit,
  CopilotChat,
  useRenderTool,
  useDefaultRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ReasoningBlock } from "./reasoning-block";
import { WeatherCard } from "./weather-card";
import { FlightListCard } from "./flight-list-card";
import type { Flight } from "./flight-list-card";
import { CustomCatchallRenderer } from "./custom-catchall-renderer";
import type { CatchallToolStatus } from "./custom-catchall-renderer";
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
