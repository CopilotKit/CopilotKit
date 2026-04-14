"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  WeatherCard,
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
  useRenderTool({
    name: "get_weather",
    parameters: z.object({
      location: z.string(),
    }),
    render: ({ args, result, status }: any) => {
      if (status !== "complete") {
        return (
          <div
            className="flex items-center gap-3 px-5 py-4 rounded-2xl max-w-sm"
            style={{
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            }}
          >
            <div className="animate-pulse text-2xl">🌤️</div>
            <div>
              <p className="text-white font-medium text-sm">
                Checking weather...
              </p>
              <p className="text-white/60 text-xs">{args.location}</p>
            </div>
          </div>
        );
      }

      return (
        <WeatherCard
          location={args.location}
          temperature={result?.temperature ?? 22}
          conditions={result?.conditions || "Clear skies"}
          humidity={result?.humidity ?? 55}
          windSpeed={result?.wind_speed ?? 12}
          feelsLike={result?.feels_like ?? result?.temperature ?? 22}
        />
      );
    },
  });

  useShowcaseSuggestions();

  return (
    <div className="flex justify-center items-center h-full w-full">
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg px-6">
        <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
      </div>
    </div>
  );
}
