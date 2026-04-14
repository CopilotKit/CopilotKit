"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  DemoErrorBoundary,
  WeatherCard,
  useShowcaseSuggestions,
  demonstrationCatalog,
} from "@copilotkit/showcase-shared";

export default function ToolRenderingDemo() {
  return (
    <DemoErrorBoundary demoName="Tool Rendering">
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="tool-rendering"
        a2ui={{ catalog: demonstrationCatalog }}
      >
        <Chat />
      </CopilotKit>
    </DemoErrorBoundary>
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
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "16px 20px",
              borderRadius: "16px",
              maxWidth: "320px",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            }}
          >
            <div style={{ fontSize: "24px", animation: "pulse 2s infinite" }}>
              🌤️
            </div>
            <div>
              <p
                style={{
                  color: "white",
                  fontWeight: 500,
                  fontSize: "14px",
                  margin: 0,
                }}
              >
                Checking weather...
              </p>
              <p
                style={{
                  color: "rgba(255,255,255,0.6)",
                  fontSize: "12px",
                  margin: 0,
                }}
              >
                {args.location}
              </p>
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
