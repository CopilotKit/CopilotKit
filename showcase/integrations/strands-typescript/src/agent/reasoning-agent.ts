/**
 * Reasoning agents: emit AG-UI REASONING_MESSAGE_* events.
 *
 * Mirrors the Python siblings `agents/reasoning_agent.py` and
 * `agents/reasoning_chain_agent.py`.
 *
 * Why a reasoning model plus the Responses API: the OpenAI Responses API
 * streams `response.reasoning_summary_text.delta` items only for native
 * reasoning models (gpt-5, o3, o4-mini and friends). The Strands bridge
 * translates those into AG-UI REASONING_MESSAGE_* events with
 * `role: "reasoning"`, which the frontend renders through the
 * `reasoningMessage` slot. gpt-4o emits no reasoning items, so the showcase's
 * default chat-completions model would never light the slot up.
 *
 * `buildReasoningAgent` is tool-free and serves reasoning-default and
 * reasoning-custom. `buildReasoningChainAgent` adds the four mock tools the
 * tool-rendering-reasoning-chain demo paints per-tool renderers for; each pill
 * drives a chained pair of calls, so the agent has to own every tool in the
 * chain to reach the closing narration.
 */

import { Agent, tool } from "@strands-agents/sdk";
import { z } from "zod";
import { StrandsAgent } from "@ag-ui/aws-strands";
import { createModel } from "./model-factory";

export const REASONING_MODEL =
  process.env.OPENAI_REASONING_MODEL ?? "gpt-5.4";

/** Responses-API model that streams reasoning summaries on every turn. */
function reasoningModel() {
  return createModel({
    openaiApi: "responses",
    reasoning: true,
    modelId: REASONING_MODEL,
  });
}

const REASONING_SYSTEM_PROMPT =
  "You are a helpful assistant. For each user question, first think " +
  "step-by-step about the approach, then give a concise answer.";

/** Tool-free agent backing reasoning-default and reasoning-custom. */
export async function buildReasoningAgent(): Promise<StrandsAgent> {
  return new StrandsAgent({
    agent: new Agent({
      model: await reasoningModel(),
      systemPrompt: REASONING_SYSTEM_PROMPT,
      tools: [],
    }),
    name: "reasoning",
    description:
      "Strands agent that streams reasoning summaries alongside its answer",
  });
}

const getWeather = tool({
  name: "get_weather",
  description: "Get the current weather for a given location.",
  inputSchema: z.object({
    location: z.string().describe("City or airport to report on."),
  }),
  callback: ({ location }) => ({
    city: location,
    temperature: 68,
    humidity: 55,
    wind_speed: 10,
    conditions: "Sunny",
  }),
});

const searchFlights = tool({
  name: "search_flights",
  description:
    "Search mock flights from an origin airport to a destination airport.",
  inputSchema: z.object({
    origin: z.string().describe("Origin airport code."),
    destination: z.string().describe("Destination airport code."),
  }),
  callback: ({ origin, destination }) => ({
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
});

const getStockPrice = tool({
  name: "get_stock_price",
  description: "Get a mock current price for a stock ticker.",
  inputSchema: z.object({
    ticker: z.string().describe("Ticker symbol to quote."),
    price_usd: z.number().optional().describe("Optional scripted price."),
    change_pct: z
      .number()
      .optional()
      .describe("Optional scripted percentage change."),
  }),
  // The optional arguments let the model (or an aimock fixture) script a
  // deterministic quote: when supplied they are echoed back verbatim.
  callback: ({ ticker, price_usd, change_pct }) => ({
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
});

const rollDice = tool({
  name: "roll_dice",
  description: "Roll a single die with the given number of sides.",
  inputSchema: z.object({
    sides: z.number().default(6).describe("Number of faces on the die."),
  }),
  callback: ({ sides }) => ({
    sides,
    result: 1 + Math.floor(Math.random() * Math.max(2, sides)),
  }),
});

const REASONING_CHAIN_SYSTEM_PROMPT = `You are a helpful travel & lifestyle concierge with mock tools for weather, flights, stock prices, and dice rolls -- they all return fake data, so call them liberally.

Your habit is to CHAIN tools when one answer naturally invites another. For a single user question, call at least TWO tools in succession when the topic allows, then compose your final reply. Default chains:
  - 'What's the weather in <city>?' -> call get_weather(<city>), then call search_flights(origin='SFO', destination=<city>) so the user also sees how to get there.
  - 'How is <ticker> doing?' -> call get_stock_price(<ticker>), then call get_stock_price on a comparable ticker (e.g. 'MSFT' or 'GOOGL') so the user can compare.
  - 'Roll a 20-sided die' -> call roll_dice(sides=20), then call roll_dice again with a different number of sides so the user sees a contrast.
  - 'Find flights from <a> to <b>' -> call search_flights(a, b), then call get_weather(<b>) for the destination.

Only skip chaining when the user has clearly asked for a single, atomic answer and more tool calls would feel intrusive. Never fabricate data that a tool could provide.`;

/** Agent backing tool-rendering-reasoning-chain. */
export async function buildReasoningChainAgent(): Promise<StrandsAgent> {
  return new StrandsAgent({
    agent: new Agent({
      model: await reasoningModel(),
      systemPrompt: REASONING_CHAIN_SYSTEM_PROMPT,
      tools: [getWeather, searchFlights, getStockPrice, rollDice],
    }),
    name: "reasoning_chain",
    description:
      "Strands agent that chains mock tools while streaming reasoning summaries",
  });
}
