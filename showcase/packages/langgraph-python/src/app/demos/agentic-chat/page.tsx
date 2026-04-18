"use client";

import React from "react";
import {
  useRenderTool,
  useAgentContext,
  useConfigureSuggestions,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { z } from "zod";

export default function AgenticChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic_chat">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  useAgentContext({
    description: "Name of the user",
    value: "Bob",
  });

  useRenderTool({
    name: "get_weather",
    parameters: z.object({
      location: z.string(),
    }),
    render: ({ args, result, status }: any) => {
      if (status !== "complete") {
        return <div data-testid="weather-info-loading">Loading weather...</div>;
      }
      return (
        <div data-testid="weather-info">
          <strong>Weather in {result?.city || args.location}</strong>
          <div>Temperature: {result?.temperature}&deg;C</div>
          <div>Humidity: {result?.humidity}%</div>
          <div>Wind Speed: {result?.windSpeed ?? result?.wind_speed} mph</div>
          <div>Conditions: {result?.conditions}</div>
        </div>
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
        title: "Weather in SF",
        message: "What's the weather in San Francisco?",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat agentId="agentic_chat" className="h-full rounded-2xl" />
      </div>
    </div>
  );
}
