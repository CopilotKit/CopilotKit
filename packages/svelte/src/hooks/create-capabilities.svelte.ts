import type { AgentCapabilities } from "@ag-ui/core";
import { createAgent } from "./create-agent.svelte";

export interface CreateCapabilitiesResult {
  capabilities: AgentCapabilities | undefined;
}

export function createCapabilities(agentId?: string): CreateCapabilitiesResult {
  const agentHandle = createAgent({ agentId });

  return {
    get capabilities() {
      const a = agentHandle.agent;
      if (a && "capabilities" in a) {
        return (a as { capabilities?: AgentCapabilities }).capabilities;
      }
      return undefined;
    },
  };
}
