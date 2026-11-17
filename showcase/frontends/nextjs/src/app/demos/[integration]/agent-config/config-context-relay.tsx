"use client";

/**
 * Publishes the current config knobs to the agent with `useAgentContext`. It
 * sits inside the `<CopilotKit>` provider, where the context store is. The
 * agent reads this entry on every turn and adds it to the model's prompt.
 */

import { useAgentContext } from "@copilotkit/react-core/v2";
import type { AgentConfig } from "./config-types";

export function ConfigContextRelay({ config }: { config: AgentConfig }) {
  useAgentContext({
    description:
      "Agent response preferences. Apply tone, expertise level, and response length to every reply.",
    value: {
      tone: config.tone,
      expertise: config.expertise,
      responseLength: config.responseLength,
    },
  });
  return null;
}
