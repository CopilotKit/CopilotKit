// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/langgraph-typescript/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Lay out a sales KPI panel and heal a broken first attempt.",
    exhaust:
      "Lay out a KPI panel that never passes validation so I can reveal the fallback.",
  },
} satisfies A2uiRecoveryConfig;
