// The pill messages are the keys of this integration's recovery fixtures
// (showcase/aimock/d6/ms-agent-dotnet/a2ui-recovery.json).
import type { A2uiRecoveryConfig } from "@/app/demos/[integration]/a2ui-recovery/config";

export default {
  catalogProtocol: "v0.9",
  formatSelector: "none",
  prompts: {
    heal: "Generate the Vantage .NET quarterly revenue board and self-heal a malformed first render.",
    exhaust:
      "Generate a .NET board that fails every validation pass so I can preview the recovery fallback.",
  },
} satisfies A2uiRecoveryConfig;
