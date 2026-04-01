import type { AgentCapabilities } from "@ag-ui/core";
import { ProxiedCopilotRuntimeAgent } from "@copilotkit/core";
import { useAgent } from "./use-agent";

/**
 * Returns the capabilities declared by the given agent (or the default agent).
 * Capabilities are fetched from the runtime at connection time and are
 * available synchronously — no loading state required.
 *
 * @param agentId - Optional agent ID. If omitted, uses the default agent.
 * @returns The agent's capabilities, or `undefined` if the agent hasn't
 *          connected yet or doesn't declare capabilities.
 */
export function useCapabilities(agentId?: string): AgentCapabilities | undefined {
  const { agent } = useAgent({ agentId });

  if (agent instanceof ProxiedCopilotRuntimeAgent) {
    return agent.capabilities;
  }

  return undefined;
}
