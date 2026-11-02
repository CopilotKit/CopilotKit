import { BuiltInAgent } from "@copilotkit/runtime";

// The agent — tuned for the café demo — runs on OpenAI.
export const agent = new BuiltInAgent({
  model: "openai/gpt-5.5",
  prompt: "Help the guest — be brief.",
  temperature: 0.2,
});
