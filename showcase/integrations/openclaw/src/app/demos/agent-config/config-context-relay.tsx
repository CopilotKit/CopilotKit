"use client";

/**
 * Publishes the current agent-config toggles to the OpenClaw agent via
 * `useAgentContext`. Lives inside the `<CopilotKit>` provider so the
 * context store is reachable. The clawg-ui AG-UI adapter appends this
 * context entry to the agent's prompt on every turn, so the OpenClaw
 * model steers its reply by the selected tone / expertise / length.
 */

import { useAgentContext } from "@copilotkit/react-core/v2";
import type { AgentConfig } from "./config-types";

export function ConfigContextRelay({ config }: { config: AgentConfig }) {
  useAgentContext({
    description:
      "Agent response preferences. Apply this tone, expertise level, and response length to every reply.",
    value: {
      tone: config.tone,
      expertise: config.expertise,
      responseLength: config.responseLength,
    },
  });
  return null;
}
