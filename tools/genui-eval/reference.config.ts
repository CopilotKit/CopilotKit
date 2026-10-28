import { defineEvalConfig } from "./src/config";

/** Scores the reference answers in fixtures/reference/ on the code tiers: every one must pass. */
export default defineEvalConfig({
  models: [{ id: "reference", model: "fake:reference" }],
  presets: {
    reference: {
      models: ["reference"],
      cases: "all",
      samples: 1,
      judge: "fake:judge",
      reflection: "fake:reflect",
    },
  },
  transports: ["markdown", "tool"],
  budgetUsd: 1,
  judge: { model: "fake:judge" },
  reflection: { model: "fake:reflect" },
  prices: {},
  concurrency: 4,
});
