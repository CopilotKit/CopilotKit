"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function ToolRenderingDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="starterAgent">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  useRenderTool({
    name: "getWeather",
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
          location={parsed?.location || args.location}
          temperature={parsed?.temperature ?? 22}
          conditions={parsed?.conditions || "Clear skies"}
          humidity={parsed?.humidity ?? 55}
          windSpeed={parsed?.windSpeed ?? 12}
          feelsLike={parsed?.feelsLike ?? parsed?.temperature ?? 22}
        />
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
        title: "Weather in New York",
        message: "Tell me about the weather in New York.",
      },
      {
        title: "Weather in Tokyo",
        message: "How's the weather in Tokyo today?",
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

function WeatherCard({
  location,
  temperature,
  conditions,
  humidity,
  windSpeed,
  feelsLike,
}: {
  location: string;
  temperature: number;
  conditions: string;
  humidity: number;
  windSpeed: number;
  feelsLike: number;
}) {
  const gradient = getGradient(conditions);
  const icon = getIcon(conditions);
  const tempF = ((temperature * 9) / 5 + 32).toFixed(0);

  return (
    <div
      data-testid="weather-card"
      className="rounded-2xl overflow-hidden shadow-xl my-4"
      style={{ background: gradient, width: "340px" }}
    >
      {/* Header */}
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h3
              data-testid="weather-city"
              className="text-lg font-bold text-white capitalize tracking-tight"
            >
              {location}
            </h3>
            <p className="text-white/60 text-xs font-medium uppercase tracking-wider mt-0.5">
              Current Weather
            </p>
          </div>
          <span className="text-5xl leading-none mt-[-4px]">{icon}</span>
        </div>

        {/* Temperature */}
        <div className="mt-5 flex items-baseline gap-2">
          <span className="text-5xl font-extralight text-white tracking-tighter">
            {temperature}°
          </span>
          <div className="flex flex-col text-white/50 text-xs leading-tight">
            <span>C</span>
            <span className="mt-0.5">{tempF}°F</span>
          </div>
        </div>

        {/* Conditions */}
        <p className="text-white/80 text-sm font-medium capitalize mt-1">
          {conditions}
        </p>
      </div>

      {/* Stats bar */}
      <div
        className="grid grid-cols-3 text-center py-3 px-6"
        style={{ background: "rgba(0,0,0,0.15)" }}
      >
        <div data-testid="weather-humidity">
          <p className="text-white/50 text-[10px] font-medium uppercase tracking-wider">
            Humidity
          </p>
          <p className="text-white text-sm font-semibold mt-0.5">{humidity}%</p>
        </div>
        <div data-testid="weather-wind" className="border-x border-white/10">
          <p className="text-white/50 text-[10px] font-medium uppercase tracking-wider">
            Wind
          </p>
          <p className="text-white text-sm font-semibold mt-0.5">
            {windSpeed} mph
          </p>
        </div>
        <div data-testid="weather-feels-like">
          <p className="text-white/50 text-[10px] font-medium uppercase tracking-wider">
            Feels Like
          </p>
          <p className="text-white text-sm font-semibold mt-0.5">
            {feelsLike}°
          </p>
        </div>
      </div>
    </div>
  );
}
