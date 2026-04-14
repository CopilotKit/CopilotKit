"use client";

import React, { useState, useEffect } from "react";
import {
  useFrontendTool,
  useRenderTool,
  useAgentContext,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { z } from "zod";
import { DemoErrorBoundary } from "@copilotkit/showcase-shared";
import {
  WeatherCard,
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
  RendererSelector,
  useRenderMode,
  ToolBasedDashboard,
  A2UIDashboard,
  HashBrownDashboard,
  OpenGenUIDashboard,
} from "@copilotkit/showcase-shared";

export default function AgenticChatDemo() {
  useEffect(() => {
    console.log("[agentic-chat] Demo mounted");
  }, []);

  return (
    <DemoErrorBoundary demoName="Agentic Chat">
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="agentic_chat"
        a2ui={{ catalog: demonstrationCatalog }}
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

  useShowcaseHooks();
  useShowcaseSuggestions();

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
    <div
      className="flex flex-col h-full w-full transition-all duration-700"
      data-testid="background-container"
      style={{ background }}
    >
      <DashboardWithRenderer agentId="agentic_chat" />
    </div>
  );
}

function DashboardWithRenderer({ agentId }: { agentId: string }) {
  const { mode, setMode } = useRenderMode();

  return (
    <div className="flex flex-col h-full">
      <RendererSelector mode={mode} onModeChange={setMode} />
      <div className="flex-1">
        {mode === "tool-based" && <ToolBasedDashboard agentId={agentId} />}
        {mode === "a2ui" && <A2UIDashboard agentId={agentId} />}
        {mode === "hashbrown" && <HashBrownDashboard />}
        {mode === "open-genui" && <OpenGenUIDashboard />}
        {mode === "json-render" && <ToolBasedDashboard agentId={agentId} />}
      </div>
    </div>
  );
}
