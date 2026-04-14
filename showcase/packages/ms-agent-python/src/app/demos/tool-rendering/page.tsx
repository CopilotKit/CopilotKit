"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { WeatherCard } from "@copilotkit/showcase-shared";

export default function ToolRenderingDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="tool-rendering">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  useRenderTool({
    name: "get_weather",
    parameters: z.object({
      location: z.string(),
    }),
    render: ({ args, result, status }: any) => {
      if (status !== "complete") {
        return <WeatherCard location={args.location} loading />;
      }

      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return (
        <WeatherCard
          location={args.location}
          city={parsed?.city}
          temperature={parsed?.temperature}
          conditions={parsed?.conditions}
          humidity={parsed?.humidity}
          windSpeed={parsed?.wind_speed}
          feelsLike={parsed?.feels_like}
        />
      );
    },
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in San Francisco",
        message: "What's the weather like in San Francisco?",
      },
      {
        title: "Weather in New York",
        message: "Tell me about the weather in New York.",
      },
      {
        title: "Weather in Tokyo",
        message: "How's the weather in Tokyo today?",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-full w-full">
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg px-6">
        <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
      </div>
    </div>
  );
}
