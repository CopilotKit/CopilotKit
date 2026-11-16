// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/strands/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Assemble a quarterly performance board and recover from a malformed first draft.",
    exhaust:
      "Assemble a board that always fails validation so I can see the fallback.",
  },
} satisfies A2uiRecoveryConfig;
