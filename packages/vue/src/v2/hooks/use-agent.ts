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

interface UseAgentPropsBase {
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

/**
 * Thread-scoped variant. `agentId`, `runtimeAgentId` and `threadId` are a matched
 * set: together they give this hook a private proxied agent — registered under the
 * local `agentId`, routing outbound to `runtimeAgentId` — that is safe to pin a
 * thread onto. Mirrors React's `UseAgentThreadScopedProps`.
 */
interface UseAgentThreadScopedProps {
  /**
   * The *local* registry id to register this hook's proxied agent under. Required
   * here: the usual fallbacks (chat configuration, then `DEFAULT_AGENT_ID`) name
   * agents that already exist, and registering over one of those throws.
   */
  agentId: MaybeRefOrGetter<string>;
  /**
   * The runtime agent to route outbound requests to while this hook exposes a
   * distinct local `agentId`. Registers a proxied agent via
   * `CopilotKitCore.registerProxiedAgent`, so several frontend agents (e.g. one
   * per open thread) can mount against one runtime agent.
   *
   * REQUIRES `threadId` — a private agent with no thread to scope behaves like
   * the shared one, minus a registration and a local id to keep unique.
   */
  runtimeAgentId: MaybeRefOrGetter<string>;
  /**
   * Thread to scope the agent's run to. Written onto the underlying agent, so
   * `/agent/run`, `/agent/connect` and `/agent/stop` address this thread.
   *
   * REQUIRES `runtimeAgentId` — an agent resolved by `agentId` alone is shared,
   * so a per-hook thread written onto it would clobber every other holder.
   */
  threadId: MaybeRefOrGetter<string>;
}

/**
 * Default variant: no thread scoping. Binds to the shared agent registered under
 * `agentId` and takes its thread from the surrounding chat configuration, gated
 * on `hasExplicitThreadId`. Mirrors React's `UseAgentUnscopedProps`.
 *
 * `threadId` and `runtimeAgentId` are typed `undefined` rather than omitted so
 * that supplying either alone matches *neither* branch — that is the type-level
 * enforcement of the all-or-nothing rule.
 */
interface UseAgentUnscopedProps {
  /**
   * Agent to bind to. Resolution precedence: this property, then the surrounding
   * chat configuration's agentId, then the global default.
   */
  agentId?: MaybeRefOrGetter<string | undefined>;
  /** Requires `runtimeAgentId`. See {@link UseAgentThreadScopedProps.threadId}. */
  threadId?: undefined;
  /** Requires `threadId`. See {@link UseAgentThreadScopedProps.runtimeAgentId}. */
  runtimeAgentId?: undefined;
}

/**
 * Props for {@link useAgent}. Two valid shapes, nothing in between:
 *
 * - **Bind to an agent** — `useAgent()`, `useAgent({ agentId })`. The shared
 *   registry instance; the thread comes from the chat configuration.
 * - **Bind a private agent to a thread** —
 *   `useAgent({ agentId, runtimeAgentId, threadId })`. All three required.
 *
 * So `{ agentId, threadId }`, `{ agentId, runtimeAgentId }` and
 * `{ runtimeAgentId, threadId }` are all compile errors, matching React.
 */
export type UseAgentProps = UseAgentPropsBase &
  (UseAgentThreadScopedProps | UseAgentUnscopedProps);

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
  // `threadId`, `runtimeAgentId` and an explicit `agentId` are all-or-nothing.
  // UseAgentProps rejects a partial set at compile time; these are the runtime
  // backstop for callers TypeScript doesn't reach (plain JS, `as any`). Same
  // three checks, same messages, as React's useAgent.
  const hasThreadId = props.threadId !== undefined;
  const hasRuntimeAgentId = props.runtimeAgentId !== undefined;
  const hasAgentId = props.agentId !== undefined;

  if (hasThreadId && !hasRuntimeAgentId) {
    throw new Error(
      "useAgent: `threadId` requires `runtimeAgentId`. A threadId is written onto a " +
        "single agent, but an agent resolved by agentId alone is shared, so scoping a " +
        "thread to it would clobber other useAgent callers. Pass a distinct local `agentId` " +
        'and the runtime agent to route to, e.g. useAgent({ agentId: "chat-1", ' +
        'runtimeAgentId: "assistant", threadId }).',
    );
  }

  if (hasRuntimeAgentId && !hasThreadId) {
    throw new Error(
      "useAgent: `runtimeAgentId` requires `threadId`. A proxied agent exists to scope a " +
        "thread to a private instance; without a threadId it behaves like the shared agent " +
        "while adding a registration and a local agentId to keep unique. Either pass the " +
        "thread, or bind to the agent directly with useAgent({ agentId }).",
    );
  }

  if (hasRuntimeAgentId && !hasAgentId) {
    throw new Error(
      "useAgent: `runtimeAgentId` requires an explicit `agentId`. The proxied agent is " +
        "registered under `agentId`, and the usual fallbacks (chat configuration, then " +
        `"${DEFAULT_AGENT_ID}") name agents that already exist — registering over one throws ` +
        "or shadows it. Pick a local id for this hook, e.g. " +
        'useAgent({ agentId: "chat-1", runtimeAgentId: "assistant", threadId }).',
    );
  }

  // After the guards, all three are present or none are.
  const isThreadScoped = hasRuntimeAgentId;

  const chatConfig = useCopilotChatConfiguration();
  const agentId = computed(
    () =>
      toValue(props.agentId) ?? chatConfig.value?.agentId ?? DEFAULT_AGENT_ID,
  );
  const runtimeAgentId = computed(() =>
    isThreadScoped ? toValue(props.runtimeAgentId) : undefined,
  );
  // Mirrors React: an explicit `threadId` prop wins, otherwise the chat
  // configuration's thread, gated on `hasExplicitThreadId` so a
  // ThreadsProvider-minted placeholder UUID doesn't overwrite the agent's own
  // auto-minted one (both are random and useless to the backend).
  const resolvedThreadId = computed(
    () =>
      toValue(props.threadId) ??
      (chatConfig.value?.hasExplicitThreadId
        ? chatConfig.value.threadId
        : undefined),
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

  // On the thread-scoped path this hook owns an agent registered under
  // `agentId` that routes to `runtimeAgentId`. Register/unregister as one
  // balanced watcher — the cleanup runs both when the ids change and when the
  // scope is disposed. Mirrors React's registration effect, including its dep
  // set (core identity plus the two ids).
  const registeredProxy = shallowRef<AbstractAgent | null>(null);
  if (isThreadScoped) {
    watch(
      [agentId, runtimeAgentId, () => copilotkit.value],
      ([id, rtId], _old, onCleanup) => {
        const { agent: proxy, unregister } =
          copilotkit.value.registerProxiedAgent({
            agentId: id as string,
            runtimeAgentId: rtId as string,
          });
        provisionalAgentCache.delete(id as string);
        registeredProxy.value = proxy;
        onCleanup(() => {
          unregister();
          registeredProxy.value = null;
        });
      },
      { immediate: true },
    );
  }

  const resolveAgent = () => {
    const id = agentId.value;
    const core = copilotkit.value;

    // Proxied path: this hook registered its own agent, so bypass the shared
    // registry lookup. Until registration lands, hand back a provisional proxy
    // so `agent` is never null and its identity stays stable.
    if (isThreadScoped) {
      const proxy = registeredProxy.value;
      if (proxy) {
        provisionalAgentCache.delete(id);
        const shouldForceUpdate = agent.value === proxy;
        agent.value = proxy;
        subscriptionAgent.value = proxy;
        if (shouldForceUpdate) triggerRef(agent);
        return;
      }

      const cachedProxy = provisionalAgentCache.get(id);
      if (cachedProxy) {
        cachedProxy.headers = { ...core.headers };
        agent.value = cachedProxy;
        subscriptionAgent.value = cachedProxy;
        return;
      }

      const provisionalProxy = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: core.runtimeUrl,
        agentId: id,
        runtimeAgentId: runtimeAgentId.value as string,
        transport: core.runtimeTransport,
        runtimeMode: "pending",
      });
      provisionalProxy.headers = { ...core.headers };
      provisionalAgentCache.set(id, provisionalProxy);
      agent.value = provisionalProxy;
      subscriptionAgent.value = provisionalProxy;
      return;
    }

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
        status === CopilotKitCoreRuntimeConnectionStatus.Connecting ||
        status === CopilotKitCoreRuntimeConnectionStatus.Error)
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
      registeredProxy,
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
    ],
    resolveAgent,
    { immediate: true },
  );

  // Pin the resolved thread onto the current agent. AbstractAgent auto-mints a
  // UUID when none is given, so without this the agent would ship its own random
  // id in /agent/run, /agent/connect and /agent/stop. Deps are deliberately just
  // the agent and the thread — matching React — so status/header churn cannot
  // re-fire this and overwrite a thread `CopilotChat` pinned for its own chat.
  // `() => agent.value`, not `agent`: Vue sets `forceTrigger` when any array
  // watch source is a shallow ref, which would re-run this on every
  // `triggerRef(agent)` — i.e. every streamed message — and re-pin a thread that
  // `CopilotChat` may have deliberately overridden for the chat it renders. A
  // getter fires only when the identity actually changes.
  watch(
    [() => agent.value, resolvedThreadId],
    ([currentAgent, threadId]) => {
      if (!currentAgent || !threadId) return;
      currentAgent.threadId = threadId as string;
    },
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
