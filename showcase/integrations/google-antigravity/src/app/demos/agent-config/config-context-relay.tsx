"use client";

/**
 * Publishes the current agent-config toggles to the agent runtime via
 * `useAgentContext`. Lives inside the `<CopilotKit>` provider so the
 * context store is reachable. On the Python side the model reads this
 * entry on every turn through the adapter's built-in `get_app_context`
 * tool.
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
