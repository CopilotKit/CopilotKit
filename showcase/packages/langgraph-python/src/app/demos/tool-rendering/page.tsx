"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

// Outer layer -- provider + layout chrome.
export default function ToolRenderingDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="tool-rendering">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

interface WeatherResult {
  city?: string;
  temperature?: number;
  humidity?: number;
  wind_speed?: number;
  conditions?: string;
}

// The actual view -- chat + tool renderer.
function Chat() {
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({
        location: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed: WeatherResult = (() => {
          if (!result) return {};
          try {
            return typeof result === "string" ? JSON.parse(result) : result;
          } catch {
            return {};
          }
        })();

        return (
          <WeatherCard
            loading={loading}
            location={parameters?.location ?? parsed.city ?? ""}
            temperature={parsed.temperature}
            humidity={parsed.humidity}
            windSpeed={parsed.wind_speed}
            conditions={parsed.conditions}
          />
        );
      },
    },
    [],
  );

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in SF",
        message: "What's the weather in San Francisco?",
      },
      {
        title: "Weather in Tokyo",
        message: "What's the weather in Tokyo?",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat agentId="tool-rendering" className="h-full rounded-2xl" />
  );
}

function WeatherCard({
  loading,
  location,
  temperature,
  humidity,
  windSpeed,
  conditions,
}: {
  loading: boolean;
  location: string;
  temperature?: number;
  humidity?: number;
  windSpeed?: number;
  conditions?: string;
}) {
  return (
    <div
      data-testid="weather-card"
      className="rounded-xl mt-4 mb-4 max-w-md w-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg"
    >
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3
              data-testid="weather-city"
              className="text-xl font-bold capitalize"
            >
              {location || "Weather"}
            </h3>
            <p className="text-white/80 text-sm">
              {loading ? "Fetching weather..." : "Current Weather"}
            </p>
          </div>
          <div className="text-4xl" aria-hidden>
            {loading ? "..." : conditionsEmoji(conditions)}
          </div>
        </div>

        {!loading && (
          <>
            <div className="mt-4 text-3xl font-bold">
              {temperature ?? "--"}&deg; F
              <span className="ml-2 text-sm font-normal capitalize text-white/80">
                {conditions}
              </span>
            </div>
            <div className="mt-4 pt-4 border-t border-white/30 grid grid-cols-2 gap-2 text-center text-sm">
              <div data-testid="weather-humidity">
                <p className="text-white/70 text-xs">Humidity</p>
                <p className="font-medium">{humidity ?? "--"}%</p>
              </div>
              <div data-testid="weather-wind">
                <p className="text-white/70 text-xs">Wind</p>
                <p className="font-medium">{windSpeed ?? "--"} mph</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function conditionsEmoji(conditions?: string): string {
  if (!conditions) return "";
  const c = conditions.toLowerCase();
  if (c.includes("sun") || c.includes("clear")) return "sun";
  if (c.includes("rain") || c.includes("storm")) return "rain";
  if (c.includes("cloud")) return "cloud";
  if (c.includes("snow")) return "snow";
  return "";
}
