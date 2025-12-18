import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useMemo, useEffect, useReducer } from "react";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import { AbstractAgent } from "@ag-ui/client";
import { ProxiedCopilotRuntimeAgent, CopilotKitCoreRuntimeConnectionStatus } from "@copilotkitnext/core";
import { Observable } from "rxjs";

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

export function useAgent({ agentId, updates }: UseAgentProps = {}) {
  agentId ??= DEFAULT_AGENT_ID;

  const { copilotkit } = useCopilotKit();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const updateFlags = useMemo(
    () => updates ?? ALL_UPDATES,
    [JSON.stringify(updates)]
  );

  const agent: AbstractAgent = useMemo(() => {
    const existing = copilotkit.getAgent(agentId);
    if (existing) {
      return existing;
    }

    const isRuntimeConfigured = copilotkit.runtimeUrl !== undefined;
    const status = copilotkit.runtimeConnectionStatus;

    // While runtime is not yet synced, return a provisional runtime agent
    if (
      isRuntimeConfigured &&
      (status === CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
        status === CopilotKitCoreRuntimeConnectionStatus.Connecting)
    ) {
      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId,
        transport: copilotkit.runtimeTransport,
      });
      // Apply current headers so runs/connects inherit them
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (provisional as any).headers = { ...copilotkit.headers };
      return provisional;
    }

    // If no runtime is configured (dev/local), return a no-op agent to satisfy the
    // non-undefined contract without forcing network behavior.
    // After runtime has synced (Connected or Error) or no runtime configured and the agent doesn't exist, throw a descriptive error
    const knownAgents = Object.keys(copilotkit.agents ?? {});
    const runtimePart = isRuntimeConfigured ? `runtimeUrl=${copilotkit.runtimeUrl}` : "no runtimeUrl";
    throw new Error(
      `useAgent: Agent '${agentId}' not found after runtime sync (${runtimePart}). ` +
        (knownAgents.length ? `Known agents: [${knownAgents.join(", ")}]` : "No agents registered.") +
        " Verify your runtime /info and/or agents__unsafe_dev_only.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agentId,
    copilotkit.agents,
    copilotkit.runtimeConnectionStatus,
    copilotkit.runtimeUrl,
    copilotkit.runtimeTransport,
    JSON.stringify(copilotkit.headers),
    copilotkit,
  ]);

  useEffect(() => {
    
    if (updateFlags.length === 0) {
      return;
    }

    const handlers: Parameters<AbstractAgent["subscribe"]>[0] = {};

    if (updateFlags.includes(UseAgentUpdate.OnMessagesChanged)) {
      handlers.onMessagesChanged = () => {
        forceUpdate();
      };
    }

    if (updateFlags.includes(UseAgentUpdate.OnStateChanged)) {
      handlers.onStateChanged = () => {
        forceUpdate();
      };
    }

    if (updateFlags.includes(UseAgentUpdate.OnRunStatusChanged)) {
      handlers.onRunInitialized = () => {
        forceUpdate();
      };
      handlers.onRunFinalized = () => {
        forceUpdate();
      };
      handlers.onRunFailed = () => {
        forceUpdate();
      };
    }

    const subscription = agent.subscribe(handlers);
    return () => subscription.unsubscribe();
  }, [agent, forceUpdate, JSON.stringify(updateFlags)]);

  return {
    agent,
  };
}
