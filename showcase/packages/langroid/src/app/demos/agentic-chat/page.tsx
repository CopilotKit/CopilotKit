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
import { WeatherCard } from "@copilotkit/showcase-shared";

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
