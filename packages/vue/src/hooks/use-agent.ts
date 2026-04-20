import { computed, shallowRef, toValue, triggerRef, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type { AbstractAgent } from "@ag-ui/client";
import { ProxiedCopilotRuntimeAgent, CopilotKitCoreRuntimeConnectionStatus } from '@copilotkit/core';
import type { CopilotRuntimeTransport } from '@copilotkit/core';
import { useCopilotKit } from "../providers/useCopilotKit";

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
  agentId?: MaybeRefOrGetter<string | undefined>;
  updates?: UseAgentUpdate[];
}

/**
 * Resolves and subscribes to a CopilotKit agent for the current Vue scope.
 *
 * It returns a reactive `agent` ref that updates when the selected agent
 * changes, when runtime connection state changes, or when subscribed update
 * events fire.
 *
 * @example
 * ```ts
 * const { agent } = useAgent({ agentId: "default" });
 * ```
 */
export function useAgent(props: UseAgentProps = {}) {
  const agentId = computed(() => toValue(props.agentId) ?? DEFAULT_AGENT_ID);
  const { copilotkit } = useCopilotKit();
  const updateFlags = computed(() => props.updates ?? ALL_UPDATES);

  const agent = shallowRef<AbstractAgent>(null!);
  const subscriptionAgent = shallowRef<AbstractAgent | null>(null);
  const provisionalAgentCache = new Map<string, ProxiedCopilotRuntimeAgent>();

  const createProvisionalAgent = (
    id: string,
    runtimeUrl: string,
    transport: CopilotRuntimeTransport,
    headers: Record<string, string>,
  ) => {
    const provisional = new ProxiedCopilotRuntimeAgent({
      runtimeUrl,
      agentId: id,
      transport,
      runtimeMode: "pending",
    });
    provisional.headers = { ...headers };
    return provisional;
  };

  const resolveAgent = () => {
    const id = agentId.value;
    const core = copilotkit.value;
    const existing = core.getAgent(id);
    if (existing) {
      provisionalAgentCache.delete(id);
      const shouldForceUpdate = agent.value === existing;
      agent.value = existing;
      subscriptionAgent.value = existing;
      if (shouldForceUpdate) {
        triggerRef(agent);
      }
      return;
    }

    const isRuntimeConfigured = core.runtimeUrl !== undefined;
    const status = core.runtimeConnectionStatus;

    if (
      isRuntimeConfigured &&
      (status === CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
        status === CopilotKitCoreRuntimeConnectionStatus.Connecting)
    ) {
      const cached = provisionalAgentCache.get(id);
      if (cached) {
        cached.headers = { ...core.headers };
        agent.value = cached;
        subscriptionAgent.value = cached;
        return;
      }

      const provisional = createProvisionalAgent(
        id,
        core.runtimeUrl!,
        core.runtimeTransport,
        core.headers,
      );
      provisionalAgentCache.set(id, provisional);
      agent.value = provisional;
      subscriptionAgent.value = provisional;
      return;
    }

    if (
      isRuntimeConfigured &&
      status === CopilotKitCoreRuntimeConnectionStatus.Error
    ) {
      agent.value = createProvisionalAgent(
        id,
        core.runtimeUrl!,
        core.runtimeTransport,
        core.headers,
      );
      subscriptionAgent.value = agent.value;
      return;
    }

    const knownAgents = Object.keys(core.agents ?? {});
    const runtimePart = isRuntimeConfigured
      ? `runtimeUrl=${core.runtimeUrl}`
      : "no runtimeUrl";
    throw new Error(
      `useAgent: Agent '${id}' not found after runtime sync (${runtimePart}). ` +
        (knownAgents.length
          ? `Known agents: [${knownAgents.join(", ")}]`
          : "No agents registered.") +
        " Verify your runtime /info and/or agents__unsafe_dev_only.",
    );
  };

  watch(
    [
      agentId,
      () => copilotkit.value.agents,
      () => copilotkit.value.runtimeConnectionStatus,
      () => copilotkit.value.runtimeUrl,
      () => copilotkit.value.runtimeTransport,
      () => JSON.stringify(copilotkit.value.headers),
    ],
    resolveAgent,
    { immediate: true },
  );

  watch(
    [subscriptionAgent, updateFlags],
    ([a, flags], _old, onCleanup) => {
      if (!a || (flags as UseAgentUpdate[]).length === 0) return;
      let disposed = false;
      let refreshQueued = false;
      const scheduleRefresh = () => {
        if (disposed || refreshQueued) {
          return;
        }
        refreshQueued = true;
        Promise.resolve().then(() => {
          refreshQueued = false;
          if (!disposed) {
            triggerRef(agent);
          }
        });
      };
      const handlers: Parameters<AbstractAgent["subscribe"]>[0] = {};
      const f = flags as UseAgentUpdate[];
      if (f.includes(UseAgentUpdate.OnMessagesChanged)) {
        handlers.onMessagesChanged = scheduleRefresh;
      }
      if (f.includes(UseAgentUpdate.OnStateChanged)) {
        handlers.onStateChanged = scheduleRefresh;
      }
      if (f.includes(UseAgentUpdate.OnRunStatusChanged)) {
        handlers.onRunStartedEvent = scheduleRefresh;
        handlers.onRunFinishedEvent = scheduleRefresh;
        handlers.onRunErrorEvent = scheduleRefresh;
        handlers.onRunInitialized = scheduleRefresh;
        handlers.onRunFinalized = scheduleRefresh;
        handlers.onRunFailed = scheduleRefresh;
      }
      const sub = (a as AbstractAgent).subscribe(handlers);
      onCleanup(() => {
        disposed = true;
        sub.unsubscribe();
      });
    },
    { immediate: true },
  );

  return { agent };
}
