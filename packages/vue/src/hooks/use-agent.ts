import { computed, shallowRef, toValue, triggerRef, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { CopilotRuntimeTransport } from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";

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
  threadId?: MaybeRefOrGetter<string | undefined>;
  updates?: UseAgentUpdate[];
  /**
   * Throttle interval (ms) for `OnMessagesChanged` refreshes.
   * Falls back to provider `defaultThrottleMs` when omitted.
   */
  throttleMs?: MaybeRefOrGetter<number | undefined>;
}

function cloneForThread(
  source: AbstractAgent,
  threadId: string,
  headers: Record<string, string>,
): AbstractAgent {
  const clone = source.clone();
  if (clone === source) {
    throw new Error(
      `useAgent: ${source.constructor.name}.clone() returned the same instance. ` +
        "clone() must return a new, independent object.",
    );
  }

  clone.threadId = threadId;
  clone.setMessages([]);
  clone.setState({});
  if (clone instanceof HttpAgent) {
    clone.headers = { ...headers };
  }
  return clone;
}

export const globalThreadCloneMap = new WeakMap<
  AbstractAgent,
  Map<string, AbstractAgent>
>();

export function getThreadClone(
  registryAgent: AbstractAgent | undefined | null,
  threadId: string | undefined | null,
): AbstractAgent | undefined {
  if (!registryAgent || !threadId) return undefined;
  return globalThreadCloneMap.get(registryAgent)?.get(threadId);
}

function getOrCreateThreadClone(
  source: AbstractAgent,
  threadId: string,
  headers: Record<string, string>,
): AbstractAgent {
  let byThread = globalThreadCloneMap.get(source);
  if (!byThread) {
    byThread = new Map();
    globalThreadCloneMap.set(source, byThread);
  }

  const existing = byThread.get(threadId);
  if (existing) {
    existing.threadId = threadId;
    if (existing instanceof HttpAgent) {
      existing.headers = { ...headers };
    }
    return existing;
  }

  const clone = cloneForThread(source, threadId, headers);
  byThread.set(threadId, clone);
  return clone;
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
  const chatConfig = useCopilotChatConfiguration();
  const threadId = computed(
    () => toValue(props.threadId) ?? chatConfig.value?.threadId,
  );
  const { copilotkit } = useCopilotKit();
  const updateFlags = computed(() => props.updates ?? ALL_UPDATES);
  const providerThrottleMs = computed(() => copilotkit.value.defaultThrottleMs);
  const hookThrottleMs = computed(() => toValue(props.throttleMs));
  const effectiveThrottleMs = computed(() => {
    const resolved = hookThrottleMs.value ?? providerThrottleMs.value ?? 0;
    if (!Number.isFinite(resolved) || resolved < 0) {
      const source =
        hookThrottleMs.value !== undefined
          ? "hook-level throttleMs"
          : "provider-level defaultThrottleMs";
      console.error(
        `useAgent: ${source} must be a non-negative finite number, got ${resolved}. Falling back to unthrottled.`,
      );
      return 0;
    }
    return resolved;
  });

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
    const resolvedThreadId = threadId.value;
    const cacheKey = resolvedThreadId ? `${id}:${resolvedThreadId}` : id;
    const core = copilotkit.value;
    const existing = core.getAgent(id);
    if (existing) {
      provisionalAgentCache.delete(cacheKey);
      provisionalAgentCache.delete(id);

      const resolvedAgent = resolvedThreadId
        ? getOrCreateThreadClone(existing, resolvedThreadId, core.headers)
        : existing;
      const shouldForceUpdate = agent.value === resolvedAgent;
      agent.value = resolvedAgent;
      subscriptionAgent.value = resolvedAgent;
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
      const cached = provisionalAgentCache.get(cacheKey);
      if (cached) {
        cached.headers = { ...core.headers };
        if (resolvedThreadId) {
          cached.threadId = resolvedThreadId;
        }
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
      if (resolvedThreadId) {
        provisional.threadId = resolvedThreadId;
      }
      provisionalAgentCache.set(cacheKey, provisional);
      agent.value = provisional;
      subscriptionAgent.value = provisional;
      return;
    }

    if (
      isRuntimeConfigured &&
      status === CopilotKitCoreRuntimeConnectionStatus.Error
    ) {
      const cached = provisionalAgentCache.get(cacheKey);
      if (cached) {
        cached.headers = { ...core.headers };
        if (resolvedThreadId) {
          cached.threadId = resolvedThreadId;
        }
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
      if (resolvedThreadId) {
        provisional.threadId = resolvedThreadId;
      }
      provisionalAgentCache.set(cacheKey, provisional);
      agent.value = provisional;
      subscriptionAgent.value = provisional;
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
      threadId,
    ],
    resolveAgent,
    { immediate: true },
  );

  watch(
    [subscriptionAgent, () => JSON.stringify(copilotkit.value.headers)],
    ([currentAgent]) => {
      if (currentAgent instanceof HttpAgent) {
        currentAgent.headers = { ...copilotkit.value.headers };
      }
    },
    { immediate: true },
  );

  watch(
    [subscriptionAgent, updateFlags, effectiveThrottleMs],
    ([a, flags, throttleMs], _old, onCleanup) => {
      if (!a || (flags as UseAgentUpdate[]).length === 0) return;
      let disposed = false;
      let refreshQueued = false;
      let timerId: ReturnType<typeof setTimeout> | null = null;

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
        if (throttleMs > 0) {
          let throttleActive = false;
          let pending = false;
          handlers.onMessagesChanged = () => {
            if (disposed) return;
            if (!throttleActive) {
              throttleActive = true;
              pending = false;
              triggerRef(agent);
              timerId = setTimeout(function trailingEdge() {
                timerId = null;
                if (!disposed && pending) {
                  pending = false;
                  triggerRef(agent);
                  timerId = setTimeout(trailingEdge, throttleMs);
                } else {
                  throttleActive = false;
                }
              }, throttleMs);
            } else {
              pending = true;
            }
          };
        } else {
          handlers.onMessagesChanged = scheduleRefresh;
        }
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
        if (timerId !== null) {
          clearTimeout(timerId);
        }
        sub.unsubscribe();
      });
    },
    { immediate: true },
  );

  return { agent };
}
