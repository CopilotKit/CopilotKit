import type { OpenAIChatModel } from "@tanstack/ai-openai";

// @region[built-in-agent-model]
export const BUILT_IN_AGENT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4";

export const BUILT_IN_AGENT_REASONING_MODEL =
  process.env.OPENAI_REASONING_MODEL ??
  process.env.REASONING_MODEL ??
  BUILT_IN_AGENT_MODEL;
// @endregion[built-in-agent-model]

// TanStack's static OpenAI model union can lag newly released model IDs. Keep
// the cast here so every adapter call still sends the runtime model string.
export const BUILT_IN_AGENT_MODEL_FOR_TANSTACK =
  BUILT_IN_AGENT_MODEL as OpenAIChatModel;

export const BUILT_IN_AGENT_REASONING_MODEL_FOR_TANSTACK =
  BUILT_IN_AGENT_REASONING_MODEL as OpenAIChatModel;
