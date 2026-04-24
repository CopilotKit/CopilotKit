"use client";

// Tool Rendering — REASONING CHAIN variant.
//
// A single cell that composes two previously-separate patterns:
//
//   1. Reasoning tokens rendered via a custom `reasoningMessage` slot —
//      the same approach used by the `agentic-chat-reasoning` cell.
//   2. Sequential tool calls rendered with:
//        get_weather     → <WeatherCard />
//        search_flights  → <FlightListCard />
//        *               → <CustomCatchallRenderer />
//      mirroring the `tool-rendering` (primary) cell.
//
// Backend: `reasoning_agent` (src/agents/reasoning_agent.py) at
// /reasoning/agui. Has `reasoning=True` so reasoning steps surface via
// AG-UI REASONING_MESSAGE_* events, plus the shared tools
// (get_weather / search_flights / get_stock_price / roll_dice) so the
// agent can produce full reasoning → tool → reasoning → tool chains.

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
      render: (props) => {
        const { result, status } = props;
        const loading = status !== "complete";
        const parsed = parseJsonResult<WeatherResult>(result);
        const location =
          (props as { parameters?: { location?: string } }).parameters
            ?.location ?? parsed.city ?? "";
        return (
          <WeatherCard
            loading={loading}
            location={location}
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

  // Agno's `search_flights(flights: list[dict])` accepts the full list as
  // the argument (the model generates the flights); the tool call's
  // `parameters.flights` is the rendering source while streaming.
  useRenderTool(
    {
      name: "search_flights",
      parameters: z.object({
        flights: z.array(z.record(z.unknown())).optional(),
      }),
      render: (props) => {
        const { status } = props;
        const loading = status !== "complete";
        const flights = ((
          props as { parameters?: { flights?: Flight[] } }
        ).parameters?.flights ?? []) as Flight[];
        return <FlightListCard loading={loading} flights={flights} />;
      },
    },
    [],
  );

  useDefaultRenderTool(
    {
      render: (props) => {
        const { name, status, result } = props;
        const params = (props as { parameters?: unknown }).parameters;
        return (
          <CustomCatchallRenderer
            name={name}
            parameters={params}
            status={status as CatchallToolStatus}
            result={result as string | undefined}
          />
        );
      },
    },
    [],
  );

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in Tokyo",
        message: "What's the weather in Tokyo?",
      },
      { title: "Compare two stocks", message: "How is AAPL doing?" },
      { title: "Chain of dice rolls", message: "Roll a 20-sided die for me." },
      {
        title: "Flights SFO → JFK",
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
