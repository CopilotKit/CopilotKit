import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
// @doc-replace
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";
// @doc-as
// @doc-end

/**
 * Built-in agent for the Open Generative UI demo.
 *
 * No bespoke tools — the runtime's `openGenerativeUI` flag (see
 * `src/app/api/copilotkit-ogui/route.ts`) injects the
 * `generateSandboxedUi` tool and wires the activity middleware. The agent
 * just needs an LLM that knows when to call it.
 */
export function createOguiAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      return chat({
        // @doc-replace
        adapter: openaiText("gpt-4o", { fetch: forwardingFetch }),
        // @doc-as
        // adapter: openaiText("gpt-4o"),
        // @doc-end
        messages,
        systemPrompts,
        tools: [],
        abortController,
      });
    },
  });
}
