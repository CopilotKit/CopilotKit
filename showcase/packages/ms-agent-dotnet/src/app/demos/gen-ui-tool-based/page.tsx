"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { DemoErrorBoundary } from "../error-boundary";

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
            <div className="text-5xl mb-4">🌤️</div>
            <p className="text-white/80">
              Ask the assistant to get the weather for a city!
            </p>
          </div>
        )}

        <div className="flex flex-col gap-4 w-full max-w-md">
          {weatherResults.map((w, i) => (
            <WeatherCard key={i} data={w} themeColor={themeColor} />
          ))}
        </div>
      </div>
    </>
  );
}

function WeatherCard({
  data,
  themeColor,
}: {
  data: WeatherResult;
  themeColor: string;
}) {
  const icon = getIcon(data.conditions);

  return (
    <div
      data-testid="weather-card"
      style={{
        borderRadius: "16px",
        background: "rgba(255,255,255,0.15)",
        backdropFilter: "blur(10px)",
        padding: "20px",
        border: "1px solid rgba(255,255,255,0.25)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h3
            data-testid="weather-city"
            style={{
              color: "white",
              fontWeight: "bold",
              fontSize: "1.25rem",
              textTransform: "capitalize",
            }}
          >
            {data.location}
          </h3>
          <p
            style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Current Weather
          </p>
        </div>
        <span style={{ fontSize: "2.5rem", lineHeight: 1 }}>{icon}</span>
      </div>

      <div
        style={{
          marginTop: "12px",
          display: "flex",
          alignItems: "baseline",
          gap: "6px",
        }}
      >
        <span style={{ fontSize: "3rem", fontWeight: 300, color: "white" }}>
          {data.temperature}°
        </span>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.875rem" }}>
          C / {((data.temperature * 9) / 5 + 32).toFixed(0)}°F
        </span>
      </div>

      <p
        style={{
          color: "rgba(255,255,255,0.75)",
          fontSize: "0.875rem",
          textTransform: "capitalize",
          marginTop: "4px",
        }}
      >
        {data.conditions}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "8px",
          marginTop: "16px",
          padding: "12px",
          borderRadius: "12px",
          background: "rgba(0,0,0,0.15)",
          textAlign: "center",
        }}
      >
        <div data-testid="weather-humidity">
          <p
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: "0.65rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Humidity
          </p>
          <p
            style={{
              color: "white",
              fontWeight: 600,
              fontSize: "0.875rem",
              marginTop: "2px",
            }}
          >
            {data.humidity}%
          </p>
        </div>
        <div
          data-testid="weather-wind"
          style={{
            borderLeft: "1px solid rgba(255,255,255,0.1)",
            borderRight: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <p
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: "0.65rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Wind
          </p>
          <p
            style={{
              color: "white",
              fontWeight: 600,
              fontSize: "0.875rem",
              marginTop: "2px",
            }}
          >
            {data.wind_speed} mph
          </p>
        </div>
        <div data-testid="weather-feels-like">
          <p
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: "0.65rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Feels Like
          </p>
          <p
            style={{
              color: "white",
              fontWeight: 600,
              fontSize: "0.875rem",
              marginTop: "2px",
            }}
          >
            {data.feelsLike}°
          </p>
        </div>
      </div>
    </div>
  );
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
