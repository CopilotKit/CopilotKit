import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import {
  baseServerTools,
  getStockPriceTool,
  getWeatherTool,
  rollDiceTool,
  searchFlightsTool,
} from "./server-tools";
import { BUILT_IN_AGENT_REASONING_MODEL_FOR_TANSTACK } from "./models";
import { convertBuiltInTanStackStream } from "./tanstack-factory";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";

/**
 * Reasoning model used by all three reasoning demos.
 *
 * GPT-5.4 is a reasoning-capable variant. These demos use OpenAI's
 * Responses API through `openaiText` because GPT-5.4 does not support
 * function tools plus reasoning effort on `/v1/chat/completions`.
 */

function createReasoningAdapter() {
  return openaiText(BUILT_IN_AGENT_REASONING_MODEL_FOR_TANSTACK, {
    fetch: forwardingFetch,
  });
}

const TOOL_RENDERING_REASONING_CHAIN_SYSTEM_PROMPT = `
You are a helpful travel and lifestyle concierge with mock tools for weather, flights, stock prices, and dice rolls. Use tools liberally and chain exactly two relevant tool calls for the demo prompts.

Demo routing rules:
- If the user asks to compare AAPL and MSFT stocks, call get_stock_price for AAPL, then call get_stock_price for MSFT. In the final answer, include "AAPL is at" and "MSFT is at".
- If the user asks to roll a 20-sided die and compare it to a smaller one, call roll_dice with sides=20, then call roll_dice with sides=6. In the final answer, include "d20 came up".
- If the user asks for flights from SFO to JFK and weather there, call search_flights with origin="SFO" and destination="JFK", then call get_weather with location="JFK".

Never fabricate data that a tool can provide. After the second tool result, send one concise final response and stop.
`;

type ReasoningAgentOptions = {
  systemPrompts?: string[];
  tools?: Array<(typeof baseServerTools)[number]>;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
};

function createReasoningAgent(options: ReasoningAgentOptions = {}) {
  const tools = options.tools ?? baseServerTools;
  const extraSystemPrompts = options.systemPrompts ?? [];
  const reasoningEffort = options.reasoningEffort ?? "low";

  return new BuiltInAgent({
    type: "custom",
    factory: async ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      const serverToolNames = new Set(tools.map((tool) => tool.name));
      const stream = chat({
        adapter: createReasoningAdapter(),
        messages,
        systemPrompts: [...extraSystemPrompts, ...systemPrompts],
        tools,
        modelOptions: {
          reasoning: {
            effort: reasoningEffort,
            summary: "detailed",
          },
        },
        abortController,
      });
      return convertBuiltInTanStackStream(stream, abortController.signal, {
        serverToolNames,
        reasoningFallbackText:
          "Reasoning through the tool sequence before responding.",
      });
    },
  });
}

/**
 * Built-in agent for `reasoning-custom` — visible thinking chain
 * during normal conversation. Uses the shared server tools so the model
 * can interleave tool calls with reasoning naturally.
 */
export function createAgenticChatReasoningAgent() {
  return createReasoningAgent();
}

/**
 * Built-in agent for `reasoning-default` — same backend behaviour
 * as `reasoning-custom`; the demo's value is that the frontend
 * passes NO custom `reasoningMessage` slot, so CopilotKit's built-in
 * `CopilotChatReasoningMessage` renders the chain. Kept as its own
 * factory for clarity even though the body is identical today.
 */
export function createReasoningDefaultRenderAgent() {
  return createAgenticChatReasoningAgent();
}

/**
 * Built-in agent for `tool-rendering-reasoning-chain` — combines visible
 * reasoning with sequential tool calls (get_weather, search_flights,
 * roll_d20, get_stock_price) so the demo can show an interleaved
 * reasoning + tool-call chain.
 */
export function createToolRenderingReasoningChainAgent() {
  return createReasoningAgent({
    systemPrompts: [TOOL_RENDERING_REASONING_CHAIN_SYSTEM_PROMPT],
    tools: [getWeatherTool, searchFlightsTool, getStockPriceTool, rollDiceTool],
    reasoningEffort: "medium",
  });
}
