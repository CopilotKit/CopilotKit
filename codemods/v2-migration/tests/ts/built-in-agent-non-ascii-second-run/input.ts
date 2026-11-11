import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";

// Positions after non-ASCII text — em dashes, arrows → and accents (é) — are
// byte offsets in ast-grep but string indexes in JavaScript.
export const agent = new BuiltInAgent({
  model: openaiText("gpt-5"),
  // Deterministic routing — the demo depends on it.
  /* TODO(copilotkit-2.0): `temperature` was removed in 2.0. Pass provider-native options in `modelOptions`. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */ temperature: 0,
});
