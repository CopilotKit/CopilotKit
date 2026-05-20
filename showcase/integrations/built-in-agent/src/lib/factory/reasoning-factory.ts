import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { baseServerTools } from "./server-tools";

/**
 * Reasoning model used by all three reasoning demos.
 *
 * gpt-5.2 streams `response.reasoning_summary_text.delta` events from
 * OpenAI's Responses API only at `effort: "xhigh"`. Direct probing on
 * 2026-05-20 against `effort: low / medium / high` (with summary auto
 * and detailed, with and without `include: ["reasoning.encrypted_content"]`,
 * with and without `store: true`, on both a simple math prompt and a
 * Bayes-theorem prompt that genuinely requires reasoning) produced
 * `reasoning_tokens: 0` in every case. Bumping to `effort: "xhigh"`
 * produced 79 summary deltas and 57 reasoning tokens for the same
 * prompt, so the chain renders.
 *
 * For comparison, o4-mini at `effort: "medium"` produces a richer chain
 * (166 deltas, 320 tokens) on the same prompt; gpt-5-pro at
 * `effort: "high"` produces 167 deltas / 384 tokens but at substantially
 * higher cost. Staying on gpt-5.2 keeps the showcase on a current-gen
 * model at acceptable cost; the trade-off is a slightly shorter visible
 * "Thinking..." card.
 *
 * The parameter-shape change (flat `reasoning_effort` to nested
 * `reasoning: { effort, summary }`) is independently required by the
 * Responses API; pre-fix every reasoning demo errored 400 on every
 * prompt.
 */
const REASONING_MODEL = process.env.REASONING_MODEL ?? "gpt-5.2";

/**
 * Built-in agent for `agentic-chat-reasoning` — visible thinking chain
 * during normal conversation. Uses the shared server tools so the model
 * can interleave tool calls with reasoning naturally.
 */
export function createAgenticChatReasoningAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      return chat({
        adapter: openaiText(REASONING_MODEL),
        messages,
        systemPrompts,
        tools: [...baseServerTools],
        modelOptions: {
          reasoning: { effort: "xhigh", summary: "auto" },
        },
        abortController,
      });
    },
  });
}

/**
 * Built-in agent for `reasoning-default-render` — same backend behaviour
 * as `agentic-chat-reasoning`; the demo's value is that the frontend
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
 * roll_dice, get_stock_price) so the demo can show an interleaved
 * reasoning + tool-call chain.
 */
export function createToolRenderingReasoningChainAgent() {
  return createAgenticChatReasoningAgent();
}
