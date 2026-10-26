import { defineEvalConfig } from "./src/config";

/**
 * The model set and the presets. Model strings are OpenRouter ids
 * (https://openrouter.ai/models); "fake:<script>" models need no key and
 * reply from fixtures/<script>/. Check the ids and prices before the first
 * real run.
 */
export default defineEvalConfig({
  models: [
    { id: "gpt", model: "openai/gpt-5-mini" },
    { id: "claude", model: "anthropic/claude-sonnet-4.5" },
    { id: "gemini", model: "google/gemini-2.5-flash" },
    {
      id: "llama",
      model: "meta-llama/llama-3.3-70b-instruct",
      provider: "groq",
    },
    { id: "qwen", model: "qwen/qwen3-32b", provider: "cerebras" },
    { id: "fake", model: "fake:offline" },
  ],
  presets: {
    smoke: { models: ["gpt", "claude"], cases: "tag:smoke", samples: 1 },
    full: {
      models: ["gpt", "claude", "gemini", "llama", "qwen"],
      cases: "all",
      samples: 3,
    },
    small: { models: ["gemini", "llama", "qwen"], cases: "all", samples: 3 },
    offline: {
      models: ["fake"],
      cases: "all",
      samples: 1,
      judge: "fake:judge",
      reflection: "fake:reflect",
    },
  },
  transports: ["markdown", "tool"],
  budgetUsd: 20,
  judge: { model: "anthropic/claude-opus-4.1" },
  reflection: { model: "openai/gpt-5" },
  prices: {
    "openai/gpt-5-mini": { input: 0.25, output: 2 },
    "anthropic/claude-sonnet-4.5": { input: 3, output: 15 },
    "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
    "meta-llama/llama-3.3-70b-instruct": { input: 0.6, output: 0.8 },
    "qwen/qwen3-32b": { input: 0.4, output: 0.8 },
    "anthropic/claude-opus-4.1": { input: 15, output: 75 },
    "openai/gpt-5": { input: 1.25, output: 10 },
  },
  concurrency: 4,
});
