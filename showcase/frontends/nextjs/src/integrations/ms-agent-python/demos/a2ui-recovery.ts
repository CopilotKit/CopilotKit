// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/ms-agent-python/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Draft the Q3 pipeline snapshot and auto-correct a malformed first render.",
    exhaust:
      "Generate a summary that fails every validation attempt so I can preview the fallback.",
  },
} satisfies A2uiRecoveryConfig;
