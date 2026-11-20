import { computed, inject, type Signal } from "@angular/core";
import type { AgentCapabilities } from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { injectAgentStore } from "./agent";
import { COPILOT_CHAT_CONFIGURATION } from "./chat-configuration";

/**
 * Returns the capabilities declared by the resolved AG-UI agent.
 *
 * @param agentId - Optional agent ID or signal. When omitted, agent resolution
 * uses the ambient chat configuration and then the default agent.
 */
export function injectCapabilities(
  agentId?: string | Signal<string | undefined>,
): Signal<AgentCapabilities | undefined> {
  const resolvedAgentId =
    agentId ??
    inject(COPILOT_CHAT_CONFIGURATION, { optional: true })?.agentId ??
    DEFAULT_AGENT_ID;
  const agentStore = injectAgentStore(resolvedAgentId);

  return computed(() => {
    const agent = agentStore().agent;
    if (agent && "capabilities" in agent) {
      return (agent as { capabilities?: AgentCapabilities }).capabilities;
    }
    return undefined;
  });
}
