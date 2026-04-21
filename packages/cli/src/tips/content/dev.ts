import type { Tip } from "../types.js";

export const devTips: Tip[] = [
  {
    id: "activation-public-key-dev",
    message:
      "Stuck? Add public key for CopilotKit lead engineer support: [copilotkit.ai/keys](https://copilotkit.ai/keys?utm_source=cli-tip-key)",
    category: "activation",
    weight: 2,
  },
  {
    id: "conversion-meeting",
    message:
      "Building something serious? Book 15 min with us: [copilotkit.ai/meet](https://copilotkit.ai/meet?utm_source=cli-tip-meeting)",
    category: "conversion",
  },
  {
    id: "conversion-enterprise",
    message:
      "Need SSO, SOC2, or self-host? See enterprise: [copilotkit.ai/enterprise](https://copilotkit.ai/enterprise?utm_source=cli-tip-enterprise)",
    category: "conversion",
  },
  {
    id: "education-doctor",
    message: "Try `copilotkit doctor` to diagnose your setup",
    category: "education",
  },
];
