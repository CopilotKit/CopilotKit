import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { openaiText } from "@tanstack/ai-openai";

export const agent = tanstackAIAgent({
  adapter: openaiText("gpt-5.5"),
  // TODO(copilotkit-2.0): `temperature` is not a `tanstackAIAgent` option. Set it in `modelOptions`, with the name the adapter uses. See https://docs.copilotkit.ai/migrate/runtime-2.0
  temperature: 0.2,
  // TODO(copilotkit-2.0): `maxOutputTokens` is not a `tanstackAIAgent` option. Set it in `modelOptions`, with the name the adapter uses. See https://docs.copilotkit.ai/migrate/runtime-2.0
  maxOutputTokens: 1024,
  // TODO(copilotkit-2.0): `providerOptions` is not a `tanstackAIAgent` option. Set it in `modelOptions`, with the name the adapter uses. See https://docs.copilotkit.ai/migrate/runtime-2.0
  providerOptions: { openai: { reasoningEffort: "low" } },
  // TODO(copilotkit-2.0): `"model"` in `overridableProperties` needs an allowlist in 2.0. List the adapters a client can pick in `adapters: { name: adapter }`. See https://docs.copilotkit.ai/migrate/runtime-2.0
  overridableProperties: ["model", "temperature"],
});
