/**
 * Mock tools of the tool-rendering-reasoning-chain agent, which chains them
 * while its reasoning streams. They are the Strands TypeScript sibling's
 * (`strands-typescript/src/agent/reasoning-agent.ts`): canned data, with
 * optional arguments an aimock fixture can use to script a quote.
 */
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

export function reasoningChainTools(): ToolSet {
  return {
    get_weather: tool({
      description: "Get the current weather for a given location.",
      inputSchema: z.object({
        location: z.string().describe("City or airport to report on."),
      }),
      execute: async ({ location }) => ({
        city: location,
        temperature: 68,
        humidity: 55,
        wind_speed: 10,
        conditions: "Sunny",
      }),
    }),
    search_flights: tool({
      description:
        "Search mock flights from an origin airport to a destination airport.",
      inputSchema: z.object({
        origin: z.string().describe("Origin airport code."),
        destination: z.string().describe("Destination airport code."),
      }),
      execute: async ({ origin, destination }) => ({
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
    }),
    get_stock_price: tool({
      description: "Get a mock current price for a stock ticker.",
      inputSchema: z.object({
        ticker: z.string().describe("Ticker symbol to quote."),
        price_usd: z.number().optional().describe("Optional scripted price."),
        change_pct: z
          .number()
          .optional()
          .describe("Optional scripted percentage change."),
      }),
      execute: async ({ ticker, price_usd, change_pct }) => ({
        ticker: ticker.toUpperCase(),
        price_usd:
          price_usd !== undefined
            ? Math.round(price_usd * 100) / 100
            : Math.round((100 + Math.random() * 400) * 100) / 100,
        change_pct:
          change_pct !== undefined
            ? Math.round(change_pct * 100) / 100
            : Math.round((Math.random() < 0.5 ? -1 : 1) * Math.random() * 300) /
              100,
      }),
    }),
    roll_dice: tool({
      description: "Roll a single die with the given number of sides.",
      inputSchema: z.object({
        sides: z.number().default(6).describe("Number of faces on the die."),
      }),
      execute: async ({ sides }) => ({
        sides,
        result: 1 + Math.floor(Math.random() * Math.max(2, sides)),
      }),
    }),
  };
}
