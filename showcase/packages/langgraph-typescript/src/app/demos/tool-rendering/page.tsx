"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  WeatherCard,
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
} from "@copilotkit/showcase-shared";

export default function ToolRenderingDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="tool-rendering"
      a2ui={{ catalog: demonstrationCatalog }}
    >
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  useShowcaseHooks();
  useShowcaseSuggestions();

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
          temperature={result?.temperature}
          conditions={result?.conditions}
          humidity={result?.humidity}
          windSpeed={result?.wind_speed}
          feelsLike={result?.feels_like}
          city={result?.city}
        />
      );
    },
  });

  return (
    <div className="flex justify-center items-center h-full w-full">
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg px-6">
        <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
      </div>
    </div>
  );
}
