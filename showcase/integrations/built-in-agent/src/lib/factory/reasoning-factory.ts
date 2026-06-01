import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { baseServerTools } from "./server-tools";

/**
 * Reasoning model used by all three reasoning demos.
 *
 * GPT-5.2 is a reasoning-capable variant; OpenAI's chat completions API
 * accepts the `reasoning_effort` parameter for it. If GPT-5.2 isn't
 * accessible in your environment swap to another reasoning-capable model
 * such as `o3` or `gpt-5-thinking`. The runtime's tanstack converter
 * already translates upstream REASONING_START / REASONING_MESSAGE_CONTENT
 * / REASONING_END events into AG-UI reasoning events, so once the model
 * emits reasoning the chain surfaces on the frontend with no extra
 * plumbing.
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
          reasoning_effort: "low",
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
