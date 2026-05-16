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

// @region[weather-tool-backend]
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const SYSTEM_PROMPT =
  "You are a helpful travel & lifestyle concierge. You have mock tools " +
  "for weather, flights, stock prices, or d20 rolls when the user asks; " +
  "otherwise reply in plain text. For flights, default origin to 'SFO' " +
  "if the user only names a destination. Call multiple tools in one " +
  "turn if asked. After tools return, summarize in one short sentence. " +
  "Never fabricate data a tool could provide.";

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
// @endregion[weather-tool-backend]

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

const rollD20 = tool(
  async ({ value }) => {
    const rolled =
      typeof value === "number" && value >= 1 && value <= 20
        ? value
        : Math.floor(Math.random() * 20) + 1;
    return { sides: 20, value: rolled, result: rolled };
  },
  {
    name: "roll_d20",
    description: "Roll a 20-sided die.",
    schema: z.object({
      value: z
        .number()
        .int()
        .optional()
        .describe(
          "Deterministic override for the roll result (used by test fixtures)",
        ),
    }),
  },
);

const model = new ChatOpenAI({ model: "gpt-4o-mini" });

export const graph = createReactAgent({
  llm: model,
  tools: [getWeather, searchFlights, getStockPrice, rollD20],
  prompt: SYSTEM_PROMPT,
});
