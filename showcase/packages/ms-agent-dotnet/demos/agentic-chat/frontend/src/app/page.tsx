"use client";

import React, { useState } from "react";
import {
  useFrontendTool,
  useRenderTool,
  useAgentContext,
  useConfigureSuggestions,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { z } from "zod";

export default function AgenticChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic-chat">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  const [background, setBackground] = useState<string>(
    "var(--copilot-kit-background-color)",
  );

  useAgentContext({
    description: "Name of the user",
    value: "Bob",
  });

  useFrontendTool({
    name: "change_background",
    description:
      "Change the background color of the chat. Can be anything that the CSS background attribute accepts.",
    parameters: z.object({
      background: z.string().describe("The background. Prefer gradients."),
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
    parameters: z.object({ location: z.string() }),
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
        title: "Change background",
        message: "Change the background to something new.",
      },
      {
        title: "Generate sonnet",
        message: "Write a short sonnet about AI.",
      },
    ],
    available: "always",
  });

  return (
    <div
      className="flex justify-center items-center h-screen w-full"
      data-testid="background-container"
      style={{ background }}
    >
      <div className="h-full w-full max-w-4xl">
        <CopilotChat agentId="agentic-chat" className="h-full rounded-2xl" />
      </div>
    </div>
  );
}
