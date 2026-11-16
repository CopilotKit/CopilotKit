// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/google-adk/a2ui-recovery.json).
// ag-ui-adk generates A2UI 1.0 operations and can stream the surface as
// A2UI Express or as Direct JSON, so the page uses the 1.0 catalog and lets
// the user pick the format.
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "1.0",
  formatSelector: "inference",
  prompts: {
    heal: "Render my Q2 sales dashboard, recovering if the first attempt is malformed.",
    exhaust:
      "Render a dashboard that keeps failing validation so I can see the fallback.",
  },
} satisfies A2uiRecoveryConfig;
