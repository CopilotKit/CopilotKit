import { computed, shallowRef, toValue, triggerRef, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { HttpAgent } from "@ag-ui/client";
import type { AbstractAgent } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type {
  CopilotRuntimeTransport,
  SubscribeToAgentSubscriber,
} from "@copilotkit/core";
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
   * Throttle interval (in milliseconds) for re-renders triggered by
   * `onMessagesChanged` and `onStateChanged` notifications. Useful to reduce
   * re-render frequency during high-frequency streaming updates.
   *
   * Uses a leading+trailing pattern with a shared window — first update
   * fires immediately, subsequent updates within the window are coalesced,
   * and a trailing timer ensures the most recent update fires after the
   * window expires. See `CopilotKitCore.subscribeToAgentWithOptions` in
   * `@copilotkit/core` for details.
   *
   * Resolved as: `throttleMs ?? provider defaultThrottleMs ?? 0`.
   * Passing `throttleMs: 0` explicitly disables throttling even when the
   * provider specifies a non-zero `defaultThrottleMs`.
   *
   * Run lifecycle callbacks (`onRunInitialized`, `onRunFinalized`,
   * `onRunFailed`, `onRunErrorEvent`) always fire immediately.
   *
   * @default undefined
   * When unset, inherits from the provider's `defaultThrottleMs`;
   * if that is also unset, the effective value is `0` (no throttle).
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
  // Read the provider-level default so it appears in the subscribe watcher
  // deps. `subscribeToAgentWithOptions` reads it from the core instance, but
  // Vue still needs the dep to know when to resubscribe (same role it plays
  // in React's `useEffect` dep array).
  const providerThrottleMs = computed(() => copilotkit.value.defaultThrottleMs);
  const hookThrottleMs = computed(() => toValue(props.throttleMs));

  const agent = shallowRef<AbstractAgent | null>(null);
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
        status === CopilotKitCoreRuntimeConnectionStatus.Connecting ||
        status === CopilotKitCoreRuntimeConnectionStatus.Error)
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
      () =>
        JSON.stringify(
          Object.entries(copilotkit.value.headers ?? {}).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
      threadId,
    ],
    resolveAgent,
    { immediate: true },
  );

  watch(
    [
      subscriptionAgent,
      () =>
        JSON.stringify(
          Object.entries(copilotkit.value.headers ?? {}).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
    ],
    ([currentAgent]) => {
      if (currentAgent instanceof HttpAgent) {
        currentAgent.headers = { ...copilotkit.value.headers };
      }
    },
    { immediate: true },
  );

  // Subscribe through the shared `CopilotKitCore.subscribeToAgentWithOptions`
  // API. Core owns:
  //   - shared leading+trailing throttle window across `onMessagesChanged`
  //     and `onStateChanged` (parity with React)
  //   - safeCall-guarded callbacks (errors in subscribers never poison the
  //     agent notification loop)
  //   - validation/fallback for invalid `throttleMs`
  //   - `onRunErrorEvent` in the run-status callback set
  //
  // The hook only schedules a microtask-batched `triggerRef(agent)` so
  // multiple synchronous notifications (e.g. state + run-status firing in
  // the same tick) coalesce into a single Vue re-render — matching React's
  // `queueMicrotask`-batched forceUpdate strategy.
  watch(
    [subscriptionAgent, updateFlags, hookThrottleMs, providerThrottleMs],
    ([a, flags], _old, onCleanup) => {
      const f = flags as UseAgentUpdate[];
      if (!a || f.length === 0) return;

      let active = true;
      let batchScheduled = false;
      const batchedRefresh = () => {
        if (!active) return;
        if (!batchScheduled) {
          batchScheduled = true;
          queueMicrotask(() => {
            batchScheduled = false;
            if (active) {
              triggerRef(agent);
            }
          });
        }
      };

      const handlers: SubscribeToAgentSubscriber = {};

      if (f.includes(UseAgentUpdate.OnMessagesChanged)) {
        // Messages fire immediately (no microtask indirection) so shared-
        // window throttling in core sees an unadorned callback. Matches
        // React's `handlers.onMessagesChanged = forceUpdate`.
        handlers.onMessagesChanged = () => {
          if (active) triggerRef(agent);
        };
      }

      if (f.includes(UseAgentUpdate.OnStateChanged)) {
        handlers.onStateChanged = batchedRefresh;
      }

      if (f.includes(UseAgentUpdate.OnRunStatusChanged)) {
        handlers.onRunInitialized = batchedRefresh;
        handlers.onRunFinalized = batchedRefresh;
        handlers.onRunFailed = batchedRefresh;
        // Protocol-level RUN_ERROR event (distinct from `onRunFailed`
        // which handles local exceptions like network errors).
        handlers.onRunErrorEvent = batchedRefresh;
      }

      const subscription = copilotkit.value.subscribeToAgentWithOptions(
        a as AbstractAgent,
        handlers,
        { throttleMs: toValue(props.throttleMs) },
      );

      onCleanup(() => {
        active = false;
        subscription.unsubscribe();
      });
    },
    { immediate: true },
  );

  return { agent };
}
