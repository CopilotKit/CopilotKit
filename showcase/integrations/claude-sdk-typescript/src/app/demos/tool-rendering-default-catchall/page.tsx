"use client";

// Tool Rendering — DEFAULT CATCH-ALL variant.
//
// Mock tools (get_weather, search_flights, get_stock_price, roll_dice) are
// registered via `useFrontendTool` with stub handlers so the Claude Agent
// SDK pass-through can call them. Frontend opts into CopilotKit's built-in
// default tool-call card via `useDefaultRenderTool()` with no config.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
  useDefaultRenderTool,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function ToolRenderingDefaultCatchallDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="tool-rendering-default-catchall"
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

  // @region[default-catchall-zero-config]
  useDefaultRenderTool();
  // @endregion[default-catchall-zero-config]

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
        title: "Roll a d20",
        message: "Roll a 20-sided die.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="tool-rendering-default-catchall"
      className="h-full rounded-2xl"
    />
  );
}
