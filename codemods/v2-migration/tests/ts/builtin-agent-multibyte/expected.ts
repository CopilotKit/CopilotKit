import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { openaiText } from "@tanstack/ai-openai";

// The agent — tuned for the café demo — runs on OpenAI.
export const agent = tanstackAIAgent({
  adapter: openaiText("gpt-5.5"),
  prompt: "Help the guest — be brief.",
  // TODO(copilotkit-2.0): `temperature` is not a `tanstackAIAgent` option. Set it in `modelOptions`, with the name the adapter uses. See https://docs.copilotkit.ai/migrate/runtime-2.0
  temperature: 0.2,
});
