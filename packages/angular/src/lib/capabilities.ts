import { computed, type Signal } from "@angular/core";
import type { AgentCapabilities } from "@ag-ui/core";
import { injectAgentStore } from "./agent";
import { injectChatConfiguration } from "./chat-configuration";

/**
 * Returns the capabilities declared by the resolved AG-UI agent.
 *
 * @param agentId - Optional agent ID or signal. When omitted, agent resolution
 * uses the ambient chat configuration and then the default agent.
 */
export function injectCapabilities(
  agentId?: string | Signal<string | undefined>,
): Signal<AgentCapabilities | undefined> {
  const resolvedAgentId = agentId ?? injectChatConfiguration().agentId;
  const agentStore = injectAgentStore(resolvedAgentId);

  return computed(() => {
    const agent = agentStore().agent;
    if (agent && "capabilities" in agent) {
      return (agent as { capabilities?: AgentCapabilities }).capabilities;
    }
    return undefined;
  });
}
