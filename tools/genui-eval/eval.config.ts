import { defineEvalConfig } from "./src/config";

/**
 * The model set and the presets. Model strings are OpenRouter ids
 * (https://openrouter.ai/models); "fake:<script>" models need no key and
 * reply from fixtures/<script>/. Check the ids and prices before the first
 * real run.
 */
export default defineEvalConfig({
  models: [
    { id: "gpt", model: "openai/gpt-5.6-luna" },
    { id: "claude", model: "anthropic/claude-sonnet-5.5" },
    { id: "gemini", model: "google/gemini-3.8-flash" },
    { id: "deepseek", model: "deepseek/deepseek-v4.1-flash" },
    { id: "qwen", model: "qwen/qwen3.8-27b" },
    { id: "fake", model: "fake:offline" },
  ],
  presets: {
    smoke: { models: ["gpt", "claude"], cases: "tag:smoke", samples: 1 },
    // The first baseline: one model, so we read its failures before paying for all five.
    gpt: { models: ["gpt"], cases: "all", samples: 3 },
    full: {
      models: ["gpt", "claude", "gemini", "deepseek", "qwen"],
      cases: "all",
      samples: 3,
    },
    small: { models: ["gemini", "deepseek", "qwen"], cases: "all", samples: 3 },
    offline: {
      models: ["fake"],
      cases: "all",
      samples: 1,
      judge: "fake:judge",
      reflection: "fake:reflect",
    },
  },
  // Markdown only for now; add "tool" (or pass --transports markdown,tool) to test the render_ui tool too.
  transports: ["markdown"],
  budgetUsd: 20,
  judge: { model: "anthropic/claude-opus-5.5" },
  reflection: { model: "openai/gpt-6.1-terra" },
  prices: {
    "openai/gpt-5.6-luna": { input: 0.2, output: 1.2 },
    "openai/gpt-6.1-terra": { input: 1, output: 5 },
    "anthropic/claude-sonnet-5.5": { input: 2, output: 10 },
    "google/gemini-3.8-flash": { input: 0.825, output: 4.125 },
    "deepseek/deepseek-v4.1-flash": { input: 0.14, output: 0.42 },
    "qwen/qwen3.8-27b": { input: 0.039, output: 1.25 },
    "anthropic/claude-opus-5.5": { input: 4, output: 20 },
  },
  concurrency: 4,
  // codex:<model> calls at once; --codex-concurrency overrides it per run.
  codexConcurrency: 10,
});
