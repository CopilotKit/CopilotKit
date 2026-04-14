"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  DemoErrorBoundary,
  WeatherCard,
  useShowcaseHooks,
} from "@copilotkit/showcase-shared";

export default function ToolRenderingDemo() {
  return (
    <DemoErrorBoundary demoName="Tool Rendering">
      <CopilotKit runtimeUrl="/api/copilotkit" agent="my_agent">
        <DemoContent />
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

function DemoContent() {
  useShowcaseHooks();

  useRenderTool({
    name: "get_weather",
    parameters: z.object({
      location: z.string(),
    }),
    render: ({ args, result, status }: any) => {
      if (status !== "complete") {
        return <WeatherCard location={args.location} loading />;
      }
      return (
        <WeatherCard
          location={args.location}
          temperature={result?.temperature ?? 20}
          conditions={result?.conditions || "Sunny"}
          humidity={result?.humidity ?? 50}
          windSpeed={result?.wind_speed ?? 10}
          feelsLike={result?.feelsLike ?? result?.feels_like}
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
        title: "Weather in Tokyo",
        message: "How's the weather in Tokyo today?",
      },
      {
        title: "Weather in New York",
        message: "Tell me about the weather in New York.",
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
