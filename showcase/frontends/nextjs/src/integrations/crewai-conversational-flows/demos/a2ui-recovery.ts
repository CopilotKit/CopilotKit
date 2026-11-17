// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/crewai-conversational-flows/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Build a CrewAI Q2 revenue summary and self-correct a malformed first attempt.",
    exhaust:
      "Build a CrewAI report that fails every validation pass so I can preview the fallback.",
  },
} satisfies A2uiRecoveryConfig;
