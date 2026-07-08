import type { AgentCapabilities } from "@ag-ui/core";
import { useAgent } from "./use-agent.svelte";

export interface UseCapabilitiesResult {
  capabilities: AgentCapabilities | undefined;
}

export function useCapabilities(agentId?: string): UseCapabilitiesResult {
  const { agent } = useAgent({ agentId });

  return {
    get capabilities() {
      const a = agent;
      if (a && "capabilities" in a) {
        return (a as { capabilities?: AgentCapabilities }).capabilities;
      }
      return undefined;
    },
  };
}
