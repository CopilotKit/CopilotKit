"use client";

// Tool Rendering — DEFAULT CATCH-ALL variant (simplest).
//
// This cell is the simplest point in the three-way progression. The
// frontend registers a handful of client-executed mock tools
// (get_weather, search_flights, get_stock_price, roll_d20) but opts ONLY
// into CopilotKit's built-in default tool-call card — no per-tool
// renderers, no custom wildcard UI.
//
// `useDefaultRenderTool()` (called with no config) registers the built-
// in `DefaultToolCallRenderer` under the `*` wildcard. That renderer
// shows the tool name, a live status pill (Running → Done), and a
// collapsible "Arguments / Result" section that fills in as the call
// progresses. Without this hook the runtime has NO `*` renderer, so
// `useRenderToolCall` falls through to `null` and tool calls are
// invisible — the user only sees the assistant's final text summary.
//
// Hermes has no backend tools, so each tool is a client-executed
// `useFrontendTool` with a deterministic fake-data handler (and NO
// per-tool `render` — the built-in default catchall paints them).

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useSuggestions } from "./suggestions";

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
  // Client-executed mock tools with deterministic fake data. No per-tool
  // `render` — the built-in default catchall renders them all.
  useFrontendTool(
    {
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
    },
    [],
  );

  useFrontendTool(
    {
      name: "search_flights",
      description:
        "Search mock flights from an origin airport to a destination airport.",
      parameters: z.object({ origin: z.string(), destination: z.string() }),
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
          { airline: "United", flight: "UA231", price_usd: 348 },
          { airline: "Delta", flight: "DL412", price_usd: 312 },
          { airline: "JetBlue", flight: "B6722", price_usd: 289 },
        ],
      }),
    },
    [],
  );

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
      }) => ({
        ticker: (ticker || "").toUpperCase(),
        price_usd: price_usd ?? 189.42,
        change_pct: change_pct ?? 1.27,
      }),
    },
    [],
  );

  useFrontendTool(
    {
      name: "roll_d20",
      description: "Roll a 20-sided die.",
      parameters: z.object({ value: z.number().optional() }),
      handler: async ({ value }: { value?: number }) => {
        const rolled =
          typeof value === "number" && value >= 1 && value <= 20 ? value : 11;
        return { sides: 20, value: rolled, result: rolled };
      },
    },
    [],
  );

  // @region[default-catchall-zero-config]
  // Opt in to CopilotKit's built-in default tool-call card. Called with
  // no config so the package-provided `DefaultToolCallRenderer` is used
  // as the wildcard renderer — this is the "out-of-the-box" UI the cell
  // is meant to showcase.
  useDefaultRenderTool();
  // @endregion[default-catchall-zero-config]

  useSuggestions();

  return (
    <CopilotChat
      agentId="tool-rendering-default-catchall"
      className="h-full rounded-2xl"
    />
  );
}
