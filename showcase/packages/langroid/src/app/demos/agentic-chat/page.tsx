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
import { DemoErrorBoundary } from "../error-boundary";

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

      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      const temp = parsed?.temperature ?? 22;
      const cond = parsed?.conditions || "Clear";
      const hum = parsed?.humidity ?? 55;
      const wind = parsed?.wind_speed ?? 12;
      const feels = parsed?.feels_like ?? temp;

      return (
        <div
          className="rounded-2xl overflow-hidden shadow-xl my-3"
          style={{ background: getGradient(cond), width: "320px" }}
        >
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white capitalize tracking-tight">
                  {parsed?.city || args.location}
                </h3>
                <p className="text-white/50 text-[10px] font-medium uppercase tracking-wider">
                  Current Weather
                </p>
              </div>
              <span className="text-4xl leading-none">{getIcon(cond)}</span>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-4xl font-extralight text-white tracking-tighter">
                {temp}°
              </span>
              <span className="text-white/40 text-xs">
                {((temp * 9) / 5 + 32).toFixed(0)}°F
              </span>
            </div>
            <p className="text-white/70 text-xs font-medium capitalize mt-0.5">
              {cond}
            </p>
          </div>
          <div
            className="grid grid-cols-3 text-center py-2.5 px-5"
            style={{ background: "rgba(0,0,0,0.15)" }}
          >
            <div>
              <p className="text-white/40 text-[9px] font-medium uppercase tracking-wider">
                Humidity
              </p>
              <p className="text-white text-xs font-semibold mt-0.5">{hum}%</p>
            </div>
            <div className="border-x border-white/10">
              <p className="text-white/40 text-[9px] font-medium uppercase tracking-wider">
                Wind
              </p>
              <p className="text-white text-xs font-semibold mt-0.5">
                {wind} mph
              </p>
            </div>
            <div>
              <p className="text-white/40 text-[9px] font-medium uppercase tracking-wider">
                Feels Like
              </p>
              <p className="text-white text-xs font-semibold mt-0.5">
                {feels}°
              </p>
            </div>
          </div>
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

function getGradient(conditions: string): string {
  const c = conditions.toLowerCase();
  if (c.includes("clear") || c.includes("sunny"))
    return "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
  if (c.includes("rain") || c.includes("storm"))
    return "linear-gradient(135deg, #4A5568 0%, #2D3748 100%)";
  if (c.includes("cloud") || c.includes("overcast"))
    return "linear-gradient(135deg, #718096 0%, #4A5568 100%)";
  if (c.includes("snow"))
    return "linear-gradient(135deg, #63B3ED 0%, #4299E1 100%)";
  return "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
}

function getIcon(conditions: string): string {
  const c = conditions.toLowerCase();
  if (c.includes("clear") || c.includes("sunny")) return "☀️";
  if (c.includes("rain") || c.includes("drizzle")) return "🌧️";
  if (c.includes("snow")) return "❄️";
  if (c.includes("thunderstorm")) return "⛈️";
  if (c.includes("cloud") || c.includes("overcast")) return "☁️";
  if (c.includes("fog")) return "🌫️";
  return "🌤️";
}
