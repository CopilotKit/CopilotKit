// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/strands-typescript/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Compose a revenue snapshot and recover if the first attempt is malformed.",
    exhaust:
      "Compose a snapshot that keeps failing validation so I can show the fallback.",
  },
} satisfies A2uiRecoveryConfig;
