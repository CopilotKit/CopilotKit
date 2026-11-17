// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/google-antigravity/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Chart the Antigravity quarterly revenue board and repair a malformed first render.",
    exhaust:
      "Chart an Antigravity board that never passes validation so I can preview the fallback.",
  },
} satisfies A2uiRecoveryConfig;
