// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/openai-agents-python/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Compose the OpenAI Agents quarterly revenue board and repair a malformed first render.",
    exhaust:
      "Compose an OpenAI Agents board that never passes validation so I can preview the fallback.",
  },
} satisfies A2uiRecoveryConfig;
