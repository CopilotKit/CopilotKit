import { BuiltInAgent } from "@copilotkit/runtime";

export const agent = new BuiltInAgent({
  model: "openai/gpt-5.5",
  temperature: 0.2,
  maxOutputTokens: 1024,
  providerOptions: { openai: { reasoningEffort: "low" } },
  overridableProperties: ["model", "temperature"],
});
