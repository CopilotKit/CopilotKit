import type { AgentCapabilities } from "@ag-ui/core";
import { computed } from "vue";
import type { ComputedRef } from "vue";
import { useAgent } from "./use-agent";

/**
 * Returns the capabilities declared by the given agent (or the default agent).
 *
 * Capabilities are populated from the runtime `/info` response at connection
 * time. The composable reads them synchronously from the agent instance — there
 * is no separate loading state, but the value will be `undefined` until the
 * runtime handshake completes.
 *
 * @param agentId - Optional agent ID. If omitted, uses the default agent.
 * @returns A computed ref containing the agent's capabilities, or `undefined`
 *          if the agent doesn't declare capabilities.
 */
export function useCapabilities(
  agentId?: string,
): ComputedRef<AgentCapabilities | undefined> {
  const { agent } = useAgent({ agentId });

  return computed(() => {
    const a = agent.value;
    if (a && "capabilities" in a) {
      return (a as { capabilities?: AgentCapabilities }).capabilities;
    }
    return undefined;
  });
}
