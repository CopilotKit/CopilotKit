"use client";

/**
 * Publishes the current agent-config toggles to the agent runtime via
 * `useAgentContext`. Lives inside the `<CopilotKit>` provider so the
 * context store is reachable. The Built-in Agent route receives this
 * context with each run and uses it to tune the system prompt.
 */

import { useAgentContext } from "@copilotkit/react-core/v2";
import type { AgentConfig } from "./config-types";

export function ConfigContextRelay({ config }: { config: AgentConfig }) {
  // @region[use-agent-context-config]
  useAgentContext({
    description:
      "Agent response preferences. Apply tone, expertise level, and response length to every reply.",
    value: {
      tone: config.tone,
      expertise: config.expertise,
      responseLength: config.responseLength,
    },
  });
  // @endregion[use-agent-context-config]
  return null;
}
