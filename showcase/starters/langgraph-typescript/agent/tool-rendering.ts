/**
 * Tool Rendering agent — TypeScript port of tool_rendering_agent.py.
 *
 * Backs the tool-rendering demos:
 *   - tool-rendering-default-catchall  (no frontend renderers)
 *   - tool-rendering-custom-catchall   (wildcard renderer on frontend)
 *   - tool-rendering                   (per-tool + catch-all on frontend)
 *
 * All cells share this backend — they differ only in how the frontend
 * renders the same tool calls.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const SYSTEM_PROMPT =
  "You are a helpful travel & lifestyle concierge. You have mock tools " +
  "for weather, flights, stock prices, and dice rolls - they all return " +
  "fake data, so call them liberally.\n\n" +
  "Your habit is to CHAIN tools when one answer naturally invites another. " +
  "For a single user question, call at least TWO tools in succession when " +
  "the topic allows before composing your final reply. Examples of " +
  "helpful chains you should default to:\n" +
  "  - 'What's the weather in Tokyo?' -> call get_weather('Tokyo'), then " +
  "call search_flights(origin='SFO', destination='Tokyo') so the user " +
  "also sees how to get there.\n" +
  "  - 'How is AAPL doing?' -> call get_stock_price('AAPL'), then call " +
  "get_stock_price on a related ticker (e.g. 'MSFT' or 'GOOGL') for " +
  "comparison.\n" +
  "  - 'Roll a d20' -> call roll_dice(20), then call roll_dice again with " +
  "a different number of sides so the user sees a contrast.\n" +
  "  - 'Find flights from SFO to JFK' -> call search_flights, then call " +
  "get_weather on the destination city.\n\n" +
  "Only skip chaining when the user has clearly asked for a single, " +
  "atomic answer and more tool calls would feel intrusive. Never " +
  "fabricate data that a tool could provide.";

const getWeather = tool(
  async ({ location }) => ({
    city: location,
    temperature: 68,
    humidity: 55,
    wind_speed: 10,
    conditions: "Sunny",
  }),
  {
    name: "get_weather",
    description:
      "Get the current weather for a given location. Useful on its own for " +
      "weather questions, and a great companion to `search_flights`.",
    schema: z.object({
      location: z.string().describe("City name"),
    }),
  },
);

const searchFlights = tool(
  async ({ origin, destination }) => ({
    origin,
    destination,
    flights: [
      {
        airline: "United",
        flight: "UA231",
        depart: "08:15",
        arrive: "16:45",
        price_usd: 348,
      },
      {
        airline: "Delta",
        flight: "DL412",
        depart: "11:20",
        arrive: "19:55",
        price_usd: 312,
      },
      {
        airline: "JetBlue",
        flight: "B6722",
        depart: "17:05",
        arrive: "01:30",
        price_usd: 289,
      },
    ],
  }),
  {
    name: "search_flights",
    description:
      "Search mock flights from an origin airport to a destination " +
      "airport. Pairs naturally with `get_weather` on the destination.",
    schema: z.object({
      origin: z.string().describe("Origin airport code"),
      destination: z.string().describe("Destination airport code"),
    }),
  },
);

const getStockPrice = tool(
  async ({ ticker }) => {
    const randInt = (lo: number, hi: number) =>
      Math.floor(Math.random() * (hi - lo + 1)) + lo;
    const sign = Math.random() < 0.5 ? -1 : 1;
    return {
      ticker: ticker.toUpperCase(),
      price_usd:
        Math.round((100 + randInt(0, 400) + randInt(0, 99) / 100) * 100) / 100,
      change_pct: Math.round(sign * (randInt(0, 300) / 100) * 100) / 100,
    };
  },
  {
    name: "get_stock_price",
    description:
      "Get a mock current price for a stock ticker. Consider pulling a " +
      "related ticker for comparison.",
    schema: z.object({
      ticker: z.string().describe("Stock ticker symbol"),
    }),
  },
);

const rollDice = tool(
  async ({ sides }) => {
    const n = sides ?? 6;
    const max = Math.max(2, n);
    return { sides: n, result: Math.floor(Math.random() * max) + 1 };
  },
  {
    name: "roll_dice",
    description:
      "Roll a single die with the given number of sides. Consider rolling " +
      "twice with different sides so the reply can show a contrast.",
    schema: z.object({
      sides: z
        .number()
        .int()
        .optional()
        .describe("Number of sides on the die (default 6)"),
    }),
  },
);

const model = new ChatOpenAI({ model: "gpt-4o-mini" });

export const graph = createReactAgent({
  llm: model,
  tools: [getWeather, searchFlights, getStockPrice, rollDice],
  prompt: SYSTEM_PROMPT,
});
