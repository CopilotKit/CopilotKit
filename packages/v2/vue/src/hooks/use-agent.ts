import {
  computed,
  shallowRef,
  toValue,
  triggerRef,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import type { AbstractAgent } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkitnext/core";
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

  const resolveAgent = () => {
    const id = agentId.value;
    const core = copilotkit.value;
    const existing = core.getAgent(id);
    if (existing) {
      agent.value = existing;
      return;
    }

    const isRuntimeConfigured = core.runtimeUrl !== undefined;
    const status = core.runtimeConnectionStatus;

    if (
      isRuntimeConfigured &&
      (status === CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
        status === CopilotKitCoreRuntimeConnectionStatus.Connecting)
    ) {
      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: core.runtimeUrl!,
        agentId: id,
        transport: core.runtimeTransport,
      });
      (provisional as { headers?: Record<string, string> }).headers = {
        ...core.headers,
      };
      agent.value = provisional;
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
      copilotkit,
    ],
    resolveAgent,
    { immediate: true },
  );

  watch(
    [agent, updateFlags],
    ([a, flags], _old, onCleanup) => {
      if (!a || (flags as UseAgentUpdate[]).length === 0) return;
      const handlers: Parameters<AbstractAgent["subscribe"]>[0] = {};
      const f = flags as UseAgentUpdate[];
      if (f.includes(UseAgentUpdate.OnMessagesChanged)) {
        handlers.onMessagesChanged = () => triggerRef(agent);
      }
      if (f.includes(UseAgentUpdate.OnStateChanged)) {
        handlers.onStateChanged = () => triggerRef(agent);
      }
      if (f.includes(UseAgentUpdate.OnRunStatusChanged)) {
        handlers.onRunInitialized = () => triggerRef(agent);
        handlers.onRunFinalized = () => triggerRef(agent);
        handlers.onRunFailed = () => triggerRef(agent);
      }
      const sub = (a as AbstractAgent).subscribe(handlers);
      onCleanup(() => sub.unsubscribe());
    },
    { immediate: true },
  );

  return { agent };
}
