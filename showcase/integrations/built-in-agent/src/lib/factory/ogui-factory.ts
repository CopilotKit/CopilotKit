import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

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
        adapter: openaiText("gpt-4o"),
        messages,
        systemPrompts,
        tools: [],
        abortController,
      });
    },
  });
}
