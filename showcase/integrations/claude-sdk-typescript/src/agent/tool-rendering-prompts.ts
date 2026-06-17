/**
 * Tool Rendering demo family — backend agent constants.
 *
 * The tool-rendering, tool-rendering-default-catchall,
 * tool-rendering-custom-catchall, and tool-rendering-reasoning-chain
 * demos register RENDER-ONLY hooks on the frontend (`useRenderTool` /
 * `useDefaultRenderTool`): the page paints cards for tool calls but
 * registers no handlers, so it never produces tool results. In the
 * langgraph-python reference these tools are owned by the backend
 * graph. On the Claude pass-through (`makeAgentHandler`) the calls
 * were forwarded to the frontend, the result never materialized, and
 * every card sat in its loading state forever — the same failure mode
 * the `/gen-ui-agent` endpoint fixed for `set_steps`.
 *
 * This module gives the family the same treatment as
 * `/headless-complete`: backend-owned tool schemas + deterministic
 * mock impls, executed inside `runAgenticLoop` so multi-leg chains
 * (5x d20 rolls, AAPL→MSFT comparison, flights→destination-weather)
 * complete and the cards leave their loading state.
 *
 * Determinism: the impls echo optional value-carrying arguments when
 * the model provides them (the aimock fixtures pass e.g.
 * `{"value":11}` / `{"ticker":"AAPL","price_usd":338.37}`), and fall
 * back to canned data otherwise — mirroring `getWeatherImpl` /
 * `getStockPriceImpl` in `headless-complete-prompt.ts`.
 */

import type Anthropic from "@anthropic-ai/sdk";

export const TOOL_RENDERING_SYSTEM_PROMPT =
  "You are a helpful, concise assistant in a demo that renders every " +
  "tool call as a branded card. Pick the right tool for each user " +
  "question and fall back to plain text when none fit.\n\n" +
  "Routing rules:\n" +
  "  - Weather questions → call `get_weather` with the location.\n" +
  "  - Flight searches → call `search_flights` with origin and " +
  "destination airport codes.\n" +
  "  - Stock/ticker questions → call `get_stock_price` with the ticker.\n" +
  "  - A d20 roll → call `roll_d20`. If the user asks for several " +
  "rolls, call it once per roll, one call per turn.\n" +
  "  - 'Chain a few tools' → call get_weather, search_flights, and " +
  "roll_d20 together in a single turn.\n\n" +
  "After the tools return, write one short sentence summarizing the " +
  "results. Never fabricate data a tool could provide.";

export const REASONING_CHAIN_SYSTEM_PROMPT =
  "You are a helpful assistant that thinks step-by-step and chains " +
  "tools across turns. When a request needs two pieces of data " +
  "(compare two stocks, roll two dice, flights plus destination " +
  "weather), fetch them with sequential tool calls — one call per " +
  "turn — reasoning between calls about what to fetch next. After " +
  "the final tool returns, summarize the comparison in one sentence.";

export const SEARCH_FLIGHTS_TOOL_SCHEMA: Anthropic.Tool = {
  name: "search_flights",
  description:
    "Search for flights between two airports. Returns a mock payload " +
    "with origin, destination, and a list of flights (airline, flight " +
    "number, departure/arrival times, price in USD).",
  input_schema: {
    type: "object",
    properties: {
      origin: {
        type: "string",
        description: "Origin airport code, e.g. SFO.",
      },
      destination: {
        type: "string",
        description: "Destination airport code, e.g. JFK.",
      },
    },
    required: ["origin", "destination"],
  },
};

export const ROLL_D20_TOOL_SCHEMA: Anthropic.Tool = {
  name: "roll_d20",
  description:
    "Roll a 20-sided die and return the value. Accepts an optional " +
    "`value` to make demo runs deterministic; omit it for a random roll.",
  input_schema: {
    type: "object",
    properties: {
      value: {
        type: "number",
        description: "Optional fixed result for deterministic demos.",
      },
    },
  },
};

export const ROLL_DICE_TOOL_SCHEMA: Anthropic.Tool = {
  name: "roll_dice",
  description:
    "Roll a die with the given number of sides and return the value.",
  input_schema: {
    type: "object",
    properties: {
      sides: {
        type: "number",
        description: "Number of sides on the die, e.g. 20 or 6.",
      },
    },
    required: ["sides"],
  },
};

/** Mirrors the `Flight` shape rendered by
 *  `demos/tool-rendering/flight-list-card.tsx`. */
export function searchFlightsImpl(
  origin: string,
  destination: string,
): Record<string, unknown> {
  return {
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
        arrive: "19:50",
        price_usd: 312,
      },
      {
        airline: "JetBlue",
        flight: "B6722",
        depart: "17:05",
        arrive: "01:35",
        price_usd: 289,
      },
    ],
  };
}

export function rollD20Impl(value?: number): Record<string, unknown> {
  return {
    value:
      typeof value === "number" ? value : Math.floor(Math.random() * 20) + 1,
  };
}

/** Deterministic per-sides results so narrations stay consistent with
 *  the aimock fixtures (d20 → 14, d6 → 4). */
const ROLL_DICE_FIXED_RESULTS: Record<number, number> = { 20: 14, 6: 4 };

export function rollDiceImpl(sides: number): Record<string, unknown> {
  const value = ROLL_DICE_FIXED_RESULTS[sides] ?? Math.ceil(sides / 2);
  return { sides, value };
}
