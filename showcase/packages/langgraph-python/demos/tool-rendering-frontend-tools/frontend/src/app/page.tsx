"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { WeatherCard } from "./weather-card";

// Frontend-tool rendering path:
// The `get_weather` tool is defined client-side via `useFrontendTool` —
// the handler runs in the browser, and the same hook registers a `render`
// for the tool call. No backend tool is invoked; the frontend owns both
// execution and rendering.

export default function ToolRenderingDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="tool-rendering-frontend-tools"
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
    parameters: z.object({
      location: z.string().describe("The city or location to check."),
    }),
    handler: async ({ location }: { location: string }) => {
      return {
        city: location,
        temperature: 68,
        humidity: 55,
        wind_speed: 10,
        conditions: "Sunny",
      };
    },
    render: ({ args, result, status }) => {
      const loading = status !== "complete";
      const parsed = (result ?? {}) as {
        city?: string;
        temperature?: number;
        humidity?: number;
        wind_speed?: number;
        conditions?: string;
      };

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
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in SF",
        message: "What's the weather in San Francisco?",
      },
      {
        title: "Weather in Tokyo",
        message: "What's the weather in Tokyo?",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="tool-rendering-frontend-tools"
      className="h-full rounded-2xl"
    />
  );
}
