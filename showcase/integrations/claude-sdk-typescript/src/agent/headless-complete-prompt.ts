/**
 * Headless Chat (Complete) demo — backend agent constants.
 *
 * Mirrors `agents/headless_complete.py` in the langgraph-python reference
 * and the equivalent claude-sdk-python set-up. The cell exercises every
 * CopilotKit rendering surface in a fully headless chat composed from
 * `useAgent` (no `<CopilotChat />`). To exercise those surfaces this
 * agent ships:
 *
 *   - two backend tools (`get_weather`, `get_stock_price`) — render via
 *     app-registered `useRenderTool` renderers on the frontend,
 *   - access to a frontend-registered `useComponent` tool
 *     (`highlight_note`) — the agent "calls" it (tool definition is
 *     forwarded by the AG-UI client) and the UI flows through the same
 *     `useRenderToolCall` path.
 *
 * The system prompt nudges the model toward the right surface per user
 * question and falls back to plain text otherwise.
 */

import type Anthropic from "@anthropic-ai/sdk";

export const HEADLESS_COMPLETE_SYSTEM_PROMPT =
  "You are a helpful, concise assistant wired into a headless chat " +
  "surface that demonstrates CopilotKit's full rendering stack. Pick " +
  "the right surface for each user question and fall back to plain " +
  "text when none of the tools fit.\n\n" +
  "Routing rules:\n" +
  "  - If the user asks about weather for a place, call `get_weather` " +
  "with the location.\n" +
  "  - If the user asks about a stock or ticker (AAPL, TSLA, MSFT, ...), " +
  "call `get_stock_price` with the ticker.\n" +
  "  - If the user asks you to highlight, flag, or mark a short note " +
  "or phrase, call the frontend `highlight_note` tool with the text " +
  "and a color (yellow, pink, green, or blue). Do NOT ask the user " +
  "for the color — pick a sensible one if they didn't say.\n" +
  "  - Otherwise, reply in plain text.\n\n" +
  "After a tool returns, write one short sentence summarizing the " +
  "result. Never fabricate data a tool could provide.";

export const HEADLESS_GET_WEATHER_TOOL_SCHEMA: Anthropic.Tool = {
  name: "get_weather",
  description:
    "Get the current weather for a given location. Returns a mock " +
    "payload with city, temperature in Fahrenheit, humidity, wind " +
    "speed, and conditions. Use this whenever the user asks about " +
    "weather anywhere.",
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

export const HEADLESS_GET_STOCK_PRICE_TOOL_SCHEMA: Anthropic.Tool = {
  name: "get_stock_price",
  description:
    "Get a mock current price for a stock ticker. Returns a payload " +
    "with the ticker symbol (uppercased), price in USD, and percentage " +
    "change for the day. Use this whenever the user asks about a stock " +
    "price.",
  input_schema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "Stock ticker symbol, e.g. 'AAPL'.",
      },
    },
    required: ["ticker"],
  },
};

export function getWeatherImpl(location: string): Record<string, unknown> {
  return {
    city: location,
    temperature: 68,
    humidity: 55,
    wind_speed: 10,
    conditions: "Sunny",
  };
}

export function getStockPriceImpl(ticker: string): Record<string, unknown> {
  return {
    ticker: ticker.toUpperCase(),
    price_usd: 189.42,
    change_pct: 1.27,
  };
}
