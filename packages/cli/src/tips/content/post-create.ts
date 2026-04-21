import type { Tip } from "../types.js";

export const postCreateTips: Tip[] = [
  {
    id: "activation-key",
    message:
      "Add your API key to unlock more MAUs and additional features: [copilotkit.ai/keys](https://copilotkit.ai/keys?utm_source=cli-tip-key)",
    category: "activation",
    weight: 2,
  },
  {
    id: "activation-public-key",
    message:
      "Add public key to unlock more features, ease debugging and extended MAUs: [copilotkit.ai/keys](https://copilotkit.ai/keys?utm_source=cli-tip-key)",
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
    id: "engagement-discord",
    message:
      "Join 1,000+ developers in Discord: [copilotkit.ai/discord](https://copilotkit.ai/discord?utm_source=cli-tip-discord)",
    category: "engagement",
  },
  {
    id: "education-doctor",
    message: "Try `copilotkit doctor` to diagnose your setup",
    category: "education",
  },
  {
    id: "docs-genui",
    message:
      "Generative UI guide: [docs.copilotkit.ai/genui](https://docs.copilotkit.ai/genui?utm_source=cli-tip-genui-docs)",
    category: "docs",
  },
];
