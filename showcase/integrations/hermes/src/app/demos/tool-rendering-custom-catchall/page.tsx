"use client";

// Tool Rendering — CUSTOM CATCH-ALL variant (middle of the progression).
//
// Same client-executed mock tools as `tool-rendering-default-catchall`,
// but this cell opts out of CopilotKit's built-in default tool-call UI
// by registering a SINGLE custom wildcard renderer via
// `useDefaultRenderTool`. The same branded card now paints every tool
// call — no per-tool renderers yet.
//
// Hermes has no backend tools, so each tool is a client-executed
// `useFrontendTool` with a deterministic fake-data handler (no per-tool
// `render` — the wildcard renderer paints them all).

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  CustomCatchallRenderer,
  type CatchallToolStatus,
} from "./custom-catchall-renderer";
import { useSuggestions } from "./suggestions";

export default function ToolRenderingCustomCatchallDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="tool-rendering-custom-catchall"
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
  // `render` — the single wildcard renderer below paints them all.
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

  // @region[use-default-render-tool-wildcard]
  // `useDefaultRenderTool` is a convenience wrapper around
  // `useRenderTool({ name: "*", ... })` — a single wildcard renderer
  // that handles every tool call not claimed by a named renderer.
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
  // @endregion[use-default-render-tool-wildcard]

  useSuggestions();

  return (
    <CopilotChat
      agentId="tool-rendering-custom-catchall"
      className="h-full rounded-2xl"
    />
  );
}
