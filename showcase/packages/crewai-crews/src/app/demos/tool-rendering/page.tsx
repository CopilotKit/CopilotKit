"use client";

import React, { useState } from "react";
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
      <CopilotKit runtimeUrl="/api/copilotkit" agent="tool-rendering">
        <Chat />
      </CopilotKit>
    </DemoErrorBoundary>
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

      return (
        <WeatherCard
          location={args.location}
          temperature={result?.temperature ?? 22}
          conditions={result?.conditions || "Clear skies"}
          humidity={result?.humidity ?? 55}
          windSpeed={result?.wind_speed ?? 12}
          feelsLike={result?.feels_like ?? result?.temperature ?? 22}
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
        title: "Research AI topics",
        message: "Research the latest developments in AI LLMs.",
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
      style={{
        borderRadius: "16px",
        overflow: "hidden",
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
        margin: "16px 0",
        background: gradient,
        width: "340px",
      }}
    >
      <div style={{ padding: "20px 24px 16px" }}>
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
                fontSize: "18px",
                fontWeight: 700,
                color: "white",
                textTransform: "capitalize",
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              {location}
            </h3>
            <p
              style={{
                color: "rgba(255,255,255,0.6)",
                fontSize: "12px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginTop: "2px",
              }}
            >
              Current Weather
            </p>
          </div>
          <span style={{ fontSize: "48px", lineHeight: 1, marginTop: "-4px" }}>
            {icon}
          </span>
        </div>
        <div
          style={{
            marginTop: "20px",
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontSize: "48px",
              fontWeight: 200,
              color: "white",
              letterSpacing: "-0.04em",
            }}
          >
            {temperature}°
          </span>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              color: "rgba(255,255,255,0.5)",
              fontSize: "12px",
              lineHeight: 1.2,
            }}
          >
            <span>C</span>
            <span style={{ marginTop: "2px" }}>{tempF}°F</span>
          </div>
        </div>
        <p
          style={{
            color: "rgba(255,255,255,0.8)",
            fontSize: "14px",
            fontWeight: 500,
            textTransform: "capitalize",
            marginTop: "4px",
          }}
        >
          {conditions}
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          textAlign: "center",
          padding: "12px 24px",
          background: "rgba(0,0,0,0.15)",
        }}
      >
        <div data-testid="weather-humidity">
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
            Humidity
          </p>
          <p
            style={{
              color: "white",
              fontSize: "14px",
              fontWeight: 600,
              marginTop: "2px",
            }}
          >
            {humidity}%
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
              fontSize: "10px",
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
              fontSize: "14px",
              fontWeight: 600,
              marginTop: "2px",
            }}
          >
            {windSpeed} mph
          </p>
        </div>
        <div data-testid="weather-feels-like">
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
            Feels Like
          </p>
          <p
            style={{
              color: "white",
              fontSize: "14px",
              fontWeight: 600,
              marginTop: "2px",
            }}
          >
            {feelsLike}°
          </p>
        </div>
      </div>
    </div>
  );
}
