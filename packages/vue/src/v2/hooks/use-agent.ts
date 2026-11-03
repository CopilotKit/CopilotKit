import { computed, shallowRef, toValue, triggerRef, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import type { AbstractAgent } from "@ag-ui/client";
import {
  ɵgetAgentResolver,
  ɵresolveAgentId,
  ɵresolveAgentThreadId,
  ɵsubscribeToAgentUpdates,
  ɵvalidateAgentBinding,
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
 * events fire, and an `isReady` ref: `false` while `agent` is a provisional
 * stand-in used before the runtime `/info` sync lands (or after it failed),
 * `true` once it is the real agent.
 *
 * @example
 * ```ts
 * const { agent } = useAgent({ agentId: "default" });
 * ```
 */
export function useAgent(props: UseAgentProps = {}) {
  // Runtime backstop for the all-or-nothing rule UseAgentProps enforces at
  // compile time (plain JS, `as any`). Same checks and messages as React.
  ɵvalidateAgentBinding({
    agentId: toValue(props.agentId),
    threadId: toValue(props.threadId),
    runtimeAgentId: toValue(props.runtimeAgentId),
  });
  const isThreadScoped = props.runtimeAgentId !== undefined;

  const chatConfig = useCopilotChatConfiguration();
  const agentId = computed(() =>
    ɵresolveAgentId({
      agentId: toValue(props.agentId),
      chatAgentId: chatConfig.value?.agentId,
    }),
  );
  const runtimeAgentId = computed(() =>
    isThreadScoped ? toValue(props.runtimeAgentId) : undefined,
  );
  const resolvedThreadId = computed(() =>
    ɵresolveAgentThreadId({
      threadId: toValue(props.threadId),
      chatThreadId: chatConfig.value?.threadId,
      chatHasExplicitThreadId: chatConfig.value?.hasExplicitThreadId,
    }),
  );
  const { copilotkit } = useCopilotKit();
  const resolver = computed(() => ɵgetAgentResolver(copilotkit.value));
  const updateFlags = computed(() => props.updates ?? ALL_UPDATES);
  // Read the provider-level default so it appears in the subscribe watcher
  // deps: core reads it, but Vue needs the dep to resubscribe.
  const providerThrottleMs = computed(() => copilotkit.value.defaultThrottleMs);
  const hookThrottleMs = computed(() => toValue(props.throttleMs));

  const agent = shallowRef<AbstractAgent | null>(null);
  const isReady = shallowRef(false);
  const resolverRevision = shallowRef(0);
  watch(
    resolver,
    (current, _old, onCleanup) => {
      onCleanup(
        current.subscribe(() => {
          resolverRevision.value = current.getSnapshot();
        }),
      );
    },
    { immediate: true },
  );

  // Thread-scoped path: this hook owns a proxied agent registered under
  // `agentId` that routes to `runtimeAgentId`. The cleanup unregisters both
  // when the ids change and when the scope is disposed.
  if (isThreadScoped) {
    watch(
      [agentId, runtimeAgentId, resolver],
      ([id, rtId, current], _old, onCleanup) => {
        if (rtId === undefined) return;
        onCleanup(current.bindProxy({ agentId: id, runtimeAgentId: rtId }));
      },
      { immediate: true },
    );
  }

  const resolveAgent = () => {
    const resolved = resolver.value.resolve({
      agentId: agentId.value,
      runtimeAgentId: runtimeAgentId.value,
      caller: "useAgent",
    });
    isReady.value = resolved.isReady;
    if (agent.value === resolved.agent) {
      triggerRef(agent);
      return;
    }
    agent.value = resolved.agent;
  };

  // Keyed on `ɵheadersGeneration`, not header VALUES: a builder's returned
  // token can change on every resolution without a new source ever being
  // set, and this must not re-run `resolveAgent` on that (#1937).
  //
  // Sources are getters, not refs: Vue's multi-source `watch` force-triggers
  // the whole array when any raw element is a shallowRef, which would defeat
  // the diffing of every other source.
  watch(
    [
      agentId,
      () => resolverRevision.value,
      () => copilotkit.value.agents,
      () => copilotkit.value.runtimeConnectionStatus,
      () => copilotkit.value.runtimeUrl,
      () => copilotkit.value.runtimeTransport,
      () => copilotkit.value.ɵheadersGeneration,
      () => copilotkit.value.credentials,
    ],
    resolveAgent,
    { immediate: true },
  );

  // Pin the resolved thread onto the current agent. Deps are just the agent
  // identity and the thread, so status or header churn cannot re-pin a thread
  // `CopilotChat` set for the chat it renders.
  watch(
    [() => agent.value, resolvedThreadId],
    ([currentAgent, threadId]) => {
      if (!currentAgent || !threadId) return;
      currentAgent.threadId = threadId;
    },
    { immediate: true },
  );

  watch(
    [
      () => agent.value,
      () => copilotkit.value.ɵheadersGeneration,
      () => copilotkit.value.credentials,
    ],
    ([currentAgent]) => {
      if (currentAgent) resolver.value.refreshRequestSettings(currentAgent);
    },
    { immediate: true },
  );

  // Core owns throttling, safe callbacks and `throttleMs` validation; the
  // re-render is microtask-batched so notifications in one tick coalesce.
  watch(
    [() => agent.value, updateFlags, hookThrottleMs, providerThrottleMs],
    ([currentAgent, flags], _old, onCleanup) => {
      if (!currentAgent) return;
      onCleanup(
        ɵsubscribeToAgentUpdates(copilotkit.value, currentAgent, {
          updates: flags,
          throttleMs: toValue(props.throttleMs),
          onUpdate: () => triggerRef(agent),
        }),
      );
    },
    { immediate: true },
  );

  return { agent, isReady };
}
