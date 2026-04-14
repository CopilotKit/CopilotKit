"use client";

import React, { useState, useEffect } from "react";
import {
  useFrontendTool,
  useRenderTool,
  useAgentContext,
  useConfigureSuggestions,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { z } from "zod";
import { DemoErrorBoundary } from "@copilotkit/showcase-shared";
import { WeatherCard, getWeatherIcon } from "@copilotkit/showcase-shared";

export default function AgenticChatDemo() {
  useEffect(() => {
    console.log("[agentic-chat] Demo mounted");
  }, []);

  return (
    <DemoErrorBoundary demoName="Agentic Chat">
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="agentic_chat"
        onError={(error) => {
          console.error("[agentic-chat] CopilotKit error:", error);
        }}
      >
        <Chat />
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

function Chat() {
  const [background, setBackground] = useState<string>("#fafaf9");

  useAgentContext({
    description: "Name of the user",
    value: "Bob",
  });

  useFrontendTool({
    name: "change_background",
    description:
      "Change the background color of the chat. ONLY call this tool when the user explicitly asks to change the background. Never call it proactively or as part of another response. Can be anything that the CSS background attribute accepts. Prefer gradients.",
    parameters: z.object({
      background: z
        .string()
        .describe("The CSS background value. Prefer gradients."),
    }),
    handler: async ({ background }: { background: string }) => {
      setBackground(background);
      return {
        status: "success",
        message: `Background changed to ${background}`,
      };
    },
  });

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
            <div className="animate-pulse text-2xl">
              {getWeatherIcon("Clear")}
            </div>
            <div>
              <p className="text-white font-medium text-sm">
                Checking weather...
              </p>
              <p className="text-white/60 text-xs">{args.location}</p>
            </div>
          </div>
        );
      }

      let parsed = result;
      if (typeof result === "string") {
        try {
          parsed = JSON.parse(result);
        } catch {
          parsed = {};
        }
      }

      return (
        <WeatherCard
          location={parsed?.city || args.location}
          temperature={parsed?.temperature ?? 22}
          conditions={parsed?.conditions || "Clear"}
          humidity={parsed?.humidity ?? 55}
          windSpeed={parsed?.wind_speed ?? 12}
          feelsLike={parsed?.feels_like ?? parsed?.temperature ?? 22}
        />
      );
    },
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Generate sonnet",
        message: "Write a short sonnet about AI.",
      },
      {
        title: "Weather check",
        message: "What's the weather like in Tokyo?",
      },
    ],
    available: "always",
  });

  return (
    <div
      className="flex justify-center items-center h-full w-full transition-all duration-700"
      data-testid="background-container"
      style={{ background }}
    >
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg px-6">
        <CopilotChat
          agentId="agentic_chat"
          className="h-full rounded-2xl max-w-6xl mx-auto"
        />
      </div>
    </div>
  );
}
