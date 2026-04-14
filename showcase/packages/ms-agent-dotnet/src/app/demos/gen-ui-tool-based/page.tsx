"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  DemoErrorBoundary,
  WeatherCard,
  useShowcaseHooks,
} from "@copilotkit/showcase-shared";

interface WeatherResult {
  location: string;
  temperature: number;
  conditions: string;
  humidity: number;
  wind_speed: number;
  feelsLike: number;
}

export default function GenUiToolBasedDemo() {
  return (
    <DemoErrorBoundary demoName="Tool-Based Generative UI">
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <CopilotKit runtimeUrl="/api/copilotkit" agent="my_agent">
          <WeatherDisplay />
        </CopilotKit>
      </div>
    </DemoErrorBoundary>
  );
}

function WeatherDisplay() {
  const [themeColor, setThemeColor] = useState("#6366f1");
  const [weatherResults, setWeatherResults] = useState<WeatherResult[]>([]);

  useShowcaseHooks();

  // The agent calls setThemeColor as a frontend tool to update UI state
  useFrontendTool({
    name: "setThemeColor",
    description:
      "Set the theme color of the application. Call this when the user asks to change the color or theme.",
    parameters: z.object({
      themeColor: z
        .string()
        .describe("The theme color to set. Make sure to pick nice colors."),
    }),
    handler: async ({ themeColor }: { themeColor: string }) => {
      setThemeColor(themeColor);
      return { status: "success", message: `Theme color set to ${themeColor}` };
    },
  });

  // The agent calls show_weather as a frontend tool to push a weather card into the UI
  useFrontendTool(
    {
      name: "show_weather",
      description:
        "Display a weather card in the UI for a given location. Call this after get_weather to show the result visually.",
      parameters: z.object({
        location: z.string().describe("The city or location name"),
        temperature: z.number().describe("Temperature in Celsius"),
        conditions: z.string().describe("Weather conditions description"),
        humidity: z.number().describe("Humidity percentage"),
        wind_speed: z.number().describe("Wind speed in mph"),
        feelsLike: z.number().describe("Feels-like temperature in Celsius"),
      }),
      followUp: false,
      handler: async (args: WeatherResult) => {
        setWeatherResults((prev) => [args, ...prev]);
        return "Weather card displayed.";
      },
    },
    [weatherResults],
  );

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Get weather",
        message: "Get the weather in San Francisco.",
      },
      {
        title: "Change theme",
        message: "Set the theme to green.",
      },
      {
        title: "Multiple cities",
        message: "Show the weather for Tokyo, London, and New York.",
      },
    ],
    available: "always",
  });

  return (
    <>
      <CopilotSidebar
        defaultOpen={true}
        labels={{ modalHeaderTitle: "Weather Assistant" }}
      />
      <div
        className="flex flex-col items-center justify-start h-full w-full overflow-y-auto p-8 transition-colors duration-500"
        style={{ background: themeColor }}
      >
        <h1 className="text-3xl font-bold text-white mb-2">
          Weather Dashboard
        </h1>
        <p className="text-white/70 italic text-sm mb-8">
          Ask the assistant to check the weather anywhere
        </p>

        {weatherResults.length === 0 && (
          <div className="bg-white/10 rounded-2xl p-8 max-w-sm text-center">
            <div className="text-5xl mb-4">{"\uD83C\uDF24\uFE0F"}</div>
            <p className="text-white/80">
              Ask the assistant to get the weather for a city!
            </p>
          </div>
        )}

        <div className="flex flex-col gap-4 w-full max-w-md">
          {weatherResults.map((w, i) => (
            <WeatherCard
              key={i}
              location={w.location}
              temperature={w.temperature}
              conditions={w.conditions}
              humidity={w.humidity}
              windSpeed={w.wind_speed}
              feelsLike={w.feelsLike}
            />
          ))}
        </div>
      </div>
    </>
  );
}
