// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/mastra/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Draft the Vantage quarterly revenue tile and mend a botched opening attempt.",
    exhaust:
      "Draft a Vantage board that flunks every validation sweep so I can preview the fallback.",
  },
} satisfies A2uiRecoveryConfig;
