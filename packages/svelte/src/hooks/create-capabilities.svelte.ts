import type { AgentCapabilities } from "@ag-ui/core";
import { createAgent } from "./create-agent.svelte";

export interface CreateCapabilitiesResult {
  capabilities: AgentCapabilities | undefined;
}

export function createCapabilities(
  agentId?: string | (() => string | undefined),
): CreateCapabilitiesResult {
  const agentHandle = createAgent({
    get agentId() {
      return typeof agentId === "function" ? agentId() : agentId;
    },
  });

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
