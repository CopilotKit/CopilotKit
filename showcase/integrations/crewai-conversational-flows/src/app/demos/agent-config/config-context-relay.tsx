"use client";

/**
 * Publishes the current agent-config toggles to the agent runtime via
 * `useAgentContext`. Lives inside the `<CopilotKit>` provider so the
 * context store is reachable. The middleware on the Python side reads
 * this entry off the agent's runtime context on every turn and routes
 * it into the model's prompt.
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
