"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function ToolRenderingDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="tool-rendering">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  useRenderTool({
    name: "get_weather",
    parameters: z.object({
      location: z.string(),
    }),
    render: ({ args, result, status }: any) => {
      if (status !== "complete") {
        return (
          <div className="bg-[#667eea] text-white p-4 rounded-lg max-w-md">
            <span className="animate-spin">Retrieving weather...</span>
          </div>
        );
      }

      const weatherResult: WeatherToolResult = {
        temperature: result?.temperature || 0,
        conditions: result?.conditions || "clear",
        humidity: result?.humidity || 0,
        windSpeed: result?.wind_speed || 0,
        feelsLike: result?.feels_like || result?.temperature || 0,
      };

      const themeColor = getThemeColor(weatherResult.conditions);

      return (
        <WeatherCard
          location={args.location}
          themeColor={themeColor}
          result={weatherResult}
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
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg">
        <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
      </div>
    </div>
  );
}

interface WeatherToolResult {
  temperature: number;
  conditions: string;
  humidity: number;
  windSpeed: number;
  feelsLike: number;
}

function getThemeColor(conditions: string): string {
  const conditionLower = conditions.toLowerCase();
  if (conditionLower.includes("clear") || conditionLower.includes("sunny")) {
    return "#667eea";
  }
  if (conditionLower.includes("rain") || conditionLower.includes("storm")) {
    return "#4A5568";
  }
  if (conditionLower.includes("cloud")) {
    return "#718096";
  }
  if (conditionLower.includes("snow")) {
    return "#63B3ED";
  }
  return "#764ba2";
}

function WeatherCard({
  location,
  themeColor,
  result,
}: {
  location?: string;
  themeColor: string;
  result: WeatherToolResult;
}) {
  return (
    <div
      data-testid="weather-card"
      style={{ backgroundColor: themeColor }}
      className="rounded-xl mt-6 mb-4 max-w-md w-full"
    >
      <div className="bg-white/20 p-4 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h3
              data-testid="weather-city"
              className="text-xl font-bold text-white capitalize"
            >
              {location}
            </h3>
            <p className="text-white">Current Weather</p>
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between">
          <div className="text-3xl font-bold text-white">
            <span>{result.temperature}&deg; C</span>
            <span className="text-sm text-white/50">
              {" / "}
              {((result.temperature * 9) / 5 + 32).toFixed(1)}&deg; F
            </span>
          </div>
          <div className="text-sm text-white capitalize">
            {result.conditions}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-white">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div data-testid="weather-humidity">
              <p className="text-white text-xs">Humidity</p>
              <p className="text-white font-medium">{result.humidity}%</p>
            </div>
            <div data-testid="weather-wind">
              <p className="text-white text-xs">Wind</p>
              <p className="text-white font-medium">{result.windSpeed} mph</p>
            </div>
            <div data-testid="weather-feels-like">
              <p className="text-white text-xs">Feels Like</p>
              <p className="text-white font-medium">{result.feelsLike}&deg;</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
