import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call, so aimock can match
// fixtures by integration context. See ../header-forwarding.ts.
import { forwardingFetch } from "../header-forwarding";

/**
 * System prompt for the `agentic_chat` named agent.
 *
 * Byte-for-byte the LGP reference (`langgraph-python/src/agents/agentic_chat.py`,
 * `system_prompt="You are a helpful, concise assistant."`). The demo is
 * prompt-only — no backend tools; the frontend may inject frontend tools at
 * runtime, which `convertInputToTanStackAI` surfaces via `input.tools`.
 */
const AGENTIC_CHAT_SYSTEM_PROMPT = "You are a helpful, concise assistant.";

/**
 * Built-in agent backing the `agentic-chat` demo — the minimum-viable chat
 * surface. Registered under the named-agent id `agentic_chat` so the
 * byte-identical LGP frontend (`agent="agentic_chat"`) resolves to it in the
 * runtime's single-route agent registry.
 */
export function createAgenticChatAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      return chat({
        adapter: openaiText("gpt-5.4", { fetch: forwardingFetch }),
        messages,
        systemPrompts: [AGENTIC_CHAT_SYSTEM_PROMPT, ...systemPrompts],
        tools: [],
        abortController,
      });
    },
  });
}
