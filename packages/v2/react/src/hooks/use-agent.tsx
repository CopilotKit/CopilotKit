import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useMemo, useEffect, useReducer, useRef } from "react";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import { AbstractAgent } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkitnext/core";
import type { CopilotKitCoreReact } from "@/lib/react-core";

export enum UseAgentUpdate {
  OnMessagesChanged = "OnMessagesChanged",
  OnStateChanged = "OnStateChanged",
  OnRunStatusChanged = "OnRunStatusChanged",
}

const ALL_UPDATES: UseAgentUpdate[] = [
  UseAgentUpdate.OnMessagesChanged,
  UseAgentUpdate.OnStateChanged,
  UseAgentUpdate.OnRunStatusChanged,
];

export interface UseAgentProps {
  agentId?: string;
  updates?: UseAgentUpdate[];
}

/**
 * Resolve the current agent for the given agentId.
 *
 * Uses a ref-backed cache for provisional agents so that the same instance is
 * returned across re-renders while the runtime is still connecting. This
 * prevents CopilotChat (and any other consumer) from seeing a new agent
 * reference on every status/header change and firing duplicate connect requests.
 *
 * When the runtime finishes connecting and a registered agent becomes available,
 * the provisional is cleared from cache and the registered agent is returned.
 * CopilotChat's connect guard ensures connect fires only once (when Connected).
 */
function resolveAgent(
  copilotkit: CopilotKitCoreReact,
  agentId: string,
  provisionalCache: Map<string, ProxiedCopilotRuntimeAgent>,
): AbstractAgent {
  // 1. Check if a registered agent exists (runtime connected and /info returned
  //    it, or a local dev agent was provided via agents__unsafe_dev_only).
  const existing = copilotkit.getAgent(agentId);

  if (existing) {
    // Clean up any provisional that was used during connecting phase
    provisionalCache.delete(agentId);
    return existing;
  }

  const isRuntimeConfigured = copilotkit.runtimeUrl !== undefined;
  const status = copilotkit.runtimeConnectionStatus;

  // 2. While runtime is not yet synced, return a stable provisional agent
  if (
    isRuntimeConfigured &&
    (status === CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
      status === CopilotKitCoreRuntimeConnectionStatus.Connecting)
  ) {
    let provisional = provisionalCache.get(agentId);
    if (!provisional) {
      provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId,
        transport: copilotkit.runtimeTransport,
      });
      provisionalCache.set(agentId, provisional);
    }
    // Always update headers to reflect the latest state
    provisional.headers = { ...copilotkit.headers };
    return provisional;
  }

  // 3. After runtime has synced (Connected or Error) and the agent doesn't
  //    exist, throw a descriptive error.
  const knownAgents = Object.keys(copilotkit.agents ?? {});
  const runtimePart = isRuntimeConfigured
    ? `runtimeUrl=${copilotkit.runtimeUrl}`
    : "no runtimeUrl";
  throw new Error(
    `useAgent: Agent '${agentId}' not found after runtime sync (${runtimePart}). ` +
      (knownAgents.length
        ? `Known agents: [${knownAgents.join(", ")}]`
        : "No agents registered.") +
      " Verify your runtime /info and/or agents__unsafe_dev_only.",
  );
}

export function useAgent({
  agentId = DEFAULT_AGENT_ID,
  updates,
}: UseAgentProps = {}) {
  const { copilotkit } = useCopilotKit();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const updateFlags = useMemo(
    () => updates ?? ALL_UPDATES,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(updates)],
  );

  // Cache provisional agents by agentId so that the same instance is returned
  // across re-renders. This avoids the old useMemo approach where volatile
  // dependencies (runtimeConnectionStatus, agents, headers) caused a new
  // ProxiedCopilotRuntimeAgent to be created on every state transition.
  const provisionalCacheRef = useRef(
    new Map<string, ProxiedCopilotRuntimeAgent>(),
  );

  // Resolve the agent synchronously during render.
  // The ref-backed cache ensures referential stability for provisional agents.
  const agent: AbstractAgent = resolveAgent(
    copilotkit,
    agentId,
    provisionalCacheRef.current,
  );

  useEffect(() => {
    if (updateFlags.length === 0) {
      return;
    }

    const handlers: Parameters<AbstractAgent["subscribe"]>[0] = {};

    if (updateFlags.includes(UseAgentUpdate.OnMessagesChanged)) {
      // Content stripping for immutableContent renderers is handled by CopilotKitCoreReact
      handlers.onMessagesChanged = () => {
        forceUpdate();
      };
    }

    if (updateFlags.includes(UseAgentUpdate.OnStateChanged)) {
      handlers.onStateChanged = forceUpdate;
    }

    if (updateFlags.includes(UseAgentUpdate.OnRunStatusChanged)) {
      handlers.onRunInitialized = forceUpdate;
      handlers.onRunFinalized = forceUpdate;
      handlers.onRunFailed = forceUpdate;
    }

    const subscription = agent.subscribe(handlers);
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, forceUpdate, JSON.stringify(updateFlags)]);

  return {
    agent,
  };
}
