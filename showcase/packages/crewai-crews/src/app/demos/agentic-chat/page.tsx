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

      const temp = result?.temperature ?? 22;
      const cond = result?.conditions || "Clear";
      const hum = result?.humidity ?? 55;
      const wind = result?.wind_speed ?? 12;
      const feels = result?.feels_like ?? temp;

      return (
        <div
          style={{
            borderRadius: "16px",
            overflow: "hidden",
            boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
            margin: "12px 0",
            background: getGradient(cond),
            width: "320px",
          }}
        >
          <div style={{ padding: "16px 20px 12px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "white",
                    textTransform: "capitalize",
                    letterSpacing: "-0.02em",
                    margin: 0,
                  }}
                >
                  {result?.city || args.location}
                </h3>
                <p
                  style={{
                    color: "rgba(255,255,255,0.5)",
                    fontSize: "10px",
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    margin: 0,
                  }}
                >
                  Current Weather
                </p>
              </div>
              <span style={{ fontSize: "36px", lineHeight: 1 }}>
                {getIcon(cond)}
              </span>
            </div>
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                alignItems: "baseline",
                gap: "6px",
              }}
            >
              <span
                style={{
                  fontSize: "36px",
                  fontWeight: 200,
                  color: "white",
                  letterSpacing: "-0.04em",
                }}
              >
                {temp}°
              </span>
              <span
                style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}
              >
                {((temp * 9) / 5 + 32).toFixed(0)}°F
              </span>
            </div>
            <p
              style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: "12px",
                fontWeight: 500,
                textTransform: "capitalize",
                marginTop: "2px",
              }}
            >
              {cond}
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              textAlign: "center",
              padding: "10px 20px",
              background: "rgba(0,0,0,0.15)",
            }}
          >
            <div>
              <p
                style={{
                  color: "rgba(255,255,255,0.4)",
                  fontSize: "9px",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  margin: 0,
                }}
              >
                Humidity
              </p>
              <p
                style={{
                  color: "white",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginTop: "2px",
                }}
              >
                {hum}%
              </p>
            </div>
            <div
              style={{
                borderLeft: "1px solid rgba(255,255,255,0.1)",
                borderRight: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <p
                style={{
                  color: "rgba(255,255,255,0.4)",
                  fontSize: "9px",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  margin: 0,
                }}
              >
                Wind
              </p>
              <p
                style={{
                  color: "white",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginTop: "2px",
                }}
              >
                {wind} mph
              </p>
            </div>
            <div>
              <p
                style={{
                  color: "rgba(255,255,255,0.4)",
                  fontSize: "9px",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  margin: 0,
                }}
              >
                Feels Like
              </p>
              <p
                style={{
                  color: "white",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginTop: "2px",
                }}
              >
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
        title: "Research AI agents",
        message: "Research the latest developments in AI agents.",
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
