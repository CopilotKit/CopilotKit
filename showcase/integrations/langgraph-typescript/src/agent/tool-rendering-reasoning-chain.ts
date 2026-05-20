/**
 * Tool Rendering (Reasoning Chain) — TypeScript port of
 * tool_rendering_reasoning_chain_agent.py.
 *
 * Minimal ReAct agent with tools: reasoning tokens plus sequential tool
 * calls for the tool-rendering-reasoning-chain cell.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const SYSTEM_PROMPT =
  "You are a travel & lifestyle concierge. When a user asks a question, " +
  "reason step-by-step and call 2+ tools in succession when relevant.";

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
    description: "Get the current weather for a given location.",
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
      "Search mock flights from an origin airport to a destination airport.",
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
    description: "Get a mock current price for a stock ticker.",
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
    description: "Roll a single die with the given number of sides.",
    schema: z.object({
      sides: z
        .number()
        .int()
        .optional()
        .describe("Number of sides on the die (default 6)"),
    }),
  },
);

// Route through a reasoning-capable model via the Responses API so the
// chain of thought streams as AG-UI `ReasoningMessage` events alongside
// the tool calls. Falls back to gpt-4o-mini (no reasoning stream) if
// `OPENAI_REASONING_MODEL` is unset.
const REASONING_MODEL = process.env.OPENAI_REASONING_MODEL ?? "gpt-5-mini";

const model = new ChatOpenAI({
  model: REASONING_MODEL,
  useResponsesApi: true,
  reasoning: { effort: "low", summary: "auto" },
});

export const graph = createReactAgent({
  llm: model,
  tools: [getWeather, searchFlights, getStockPrice, rollDice],
  prompt: SYSTEM_PROMPT,
});
