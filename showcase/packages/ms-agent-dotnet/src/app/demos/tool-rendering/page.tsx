"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { DemoErrorBoundary } from "../error-boundary";

export default function ToolRenderingDemo() {
  return (
    <DemoErrorBoundary demoName="Tool Rendering">
      <CopilotKit runtimeUrl="/api/copilotkit" agent="my_agent">
        <DemoContent />
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

function DemoContent() {
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

      const temp = result?.temperature ?? 20;
      const cond = result?.conditions || "Sunny";
      const hum = result?.humidity ?? 50;
      const wind = result?.wind_speed ?? 10;
      const feels = result?.feelsLike ?? result?.feels_like ?? temp;
      const gradient = getGradient(cond);
      const icon = getIcon(cond);

      return (
        <div
          data-testid="weather-card"
          className="rounded-2xl overflow-hidden shadow-xl my-3"
          style={{ background: gradient, width: "320px" }}
        >
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <h3
                  data-testid="weather-city"
                  className="text-base font-bold text-white capitalize tracking-tight"
                >
                  {args.location}
                </h3>
                <p className="text-white/50 text-[10px] font-medium uppercase tracking-wider">
                  Current Weather
                </p>
              </div>
              <span className="text-4xl leading-none">{icon}</span>
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
            <div data-testid="weather-humidity">
              <p className="text-white/40 text-[9px] font-medium uppercase tracking-wider">
                Humidity
              </p>
              <p className="text-white text-xs font-semibold mt-0.5">{hum}%</p>
            </div>
            <div
              data-testid="weather-wind"
              className="border-x border-white/10"
            >
              <p className="text-white/40 text-[9px] font-medium uppercase tracking-wider">
                Wind
              </p>
              <p className="text-white text-xs font-semibold mt-0.5">
                {wind} mph
              </p>
            </div>
            <div data-testid="weather-feels-like">
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
        title: "Weather in San Francisco",
        message: "What's the weather like in San Francisco?",
      },
      {
        title: "Weather in Tokyo",
        message: "How's the weather in Tokyo today?",
      },
      {
        title: "Weather in New York",
        message: "Tell me about the weather in New York.",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-full w-full">
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg px-6">
        <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
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
