// Docs-only snippet -- not imported or executed. The production Claude SDK
// backend in `src/agent_server.ts` imports the shared weather schema/handler
// from `src/agent/headless-complete-prompt.ts`; this sibling keeps the
// tool-rendering docs focused on the one backend tool being rendered.

// @region[weather-tool-backend]
import type Anthropic from "@anthropic-ai/sdk";

export const GET_WEATHER_TOOL: Anthropic.Tool = {
  name: "get_weather",
  description:
    "Get the current weather for a given location. Useful on its own for " +
    "weather questions, and a great companion to `search_flights`.",
  input_schema: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "The city or region to get weather for.",
      },
    },
    required: ["location"],
  },
};

export function getWeather(location: string): Record<string, unknown> {
  return {
    city: location,
    temperature: 68,
    humidity: 55,
    wind_speed: 10,
    conditions: "Sunny",
  };
}
// @endregion[weather-tool-backend]
