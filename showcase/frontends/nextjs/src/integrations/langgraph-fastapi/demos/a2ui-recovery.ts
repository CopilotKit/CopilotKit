// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/langgraph-fastapi/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Put together a quarterly metrics overview and repair a malformed first attempt.",
    exhaust:
      "Put together an overview whose every render is invalid so I can see the fallback.",
  },
} satisfies A2uiRecoveryConfig;
