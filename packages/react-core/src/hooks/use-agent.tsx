import { useCopilotKit, useDefaultAgentId } from "../context";
import { useMemo, useEffect, useReducer, useSyncExternalStore } from "react";
import {
  ɵgetAgentResolver,
  ɵresolveAgentId,
  ɵresolveAgentThreadId,
  ɵsubscribeToAgentUpdates,
  ɵvalidateAgentBinding,
} from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";

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
   * window expires. See `CopilotKitCore.subscribeToAgentWithOptions` in `@copilotkit/core`
   * for details.
   *
   * Resolved as: `throttleMs ?? provider defaultThrottleMs ?? 0`.
   * Passing `throttleMs={0}` explicitly disables throttling even when the
   * provider specifies a non-zero `defaultThrottleMs`.
   *
   * Run lifecycle callbacks (`onRunInitialized`, `onRunFinalized`,
   * `onRunFailed`, `onRunErrorEvent`) always fire immediately.
   *
   * @default undefined
   * When unset, inherits from the provider's `defaultThrottleMs`;
   * if that is also unset, the effective value is `0` (no throttle).
   */
  throttleMs?: number;
}

/**
 * Thread-scoped variant. `agentId`, `runtimeAgentId`, and `threadId` are a
 * matched set: together they give this hook a *private* agent — registered
 * under the local `agentId`, routing outbound to `runtimeAgentId` — that is
 * safe to pin a thread onto. None of the three is meaningful without the other
 * two, so all are required here.
 */
interface UseAgentThreadScopedProps {
  /**
   * The name to register this hook's proxied agent under.
   *
   * Required, and must not already be taken. The usual fallbacks (the chat
   * configuration's agentId, then `DEFAULT_AGENT_ID`) name agents that already
   * exist, and registering over one either throws `already registered` or
   * silently shadows it, depending on whether runtime discovery has landed — so
   * the caller has to name it.
   */
  agentId: string;
  /**
   * Thread to scope the agent's run to. Written onto the underlying agent, so
   * `/agent/run`, `/agent/connect`, and `/agent/stop` address this thread.
   *
   * REQUIRES `runtimeAgentId`. A runtime agent registered under a given id is a
   * singleton, so writing a per-hook threadId directly onto it would let two
   * `useAgent` calls that share an `agentId` clobber each other's thread.
   * Passing a distinct local `agentId` plus the `runtimeAgentId` it routes to
   * gives this hook a private proxied agent to pin the thread onto instead of a
   * shared one.
   */
  threadId: string;
  /**
   * The id of the runtime agent to route outbound requests to, while this hook
   * exposes a distinct local `agentId`. Registers a proxied agent via
   * `CopilotKitCore.registerProxiedAgent`, letting several frontend agents
   * (e.g. one per open thread) mount against a single runtime agent without a
   * shared-singleton collision.
   *
   * When set, `agentId` is the *local* registry id (must not collide with an
   * existing local or runtime-discovered agent) and `runtimeAgentId` is the
   * runtime agent the proxy addresses on `/agent/run` etc.
   *
   * REQUIRES `threadId`. Registering a private agent is only worth doing to
   * scope a thread to it; without a `threadId` the private agent would take its
   * thread from the chat configuration, which is what binding to the shared
   * agent via `agentId` alone already does — just with an extra registration
   * and a local id to keep unique.
   */
  runtimeAgentId: string;
}

/**
 * Default variant: neither `threadId` nor `runtimeAgentId`. The hook binds to
 * the shared agent registered under `agentId` and leaves its threadId to the
 * chat configuration (or to the agent's own auto-minted UUID).
 *
 * Both props are typed `undefined` here rather than omitted so that supplying
 * either one on its own fails to match *both* branches — that is the
 * type-level enforcement of the all-or-nothing rule.
 */
interface UseAgentUnscopedProps {
  /**
   * Agent to bind to. Resolution precedence: this property, then the surrounding
   * chat configuration's agentId, then the global default.
   */
  agentId?: string;
  /** Requires `runtimeAgentId`. See {@link UseAgentThreadScopedProps.threadId}. */
  threadId?: undefined;
  /** Requires `threadId`. See {@link UseAgentThreadScopedProps.runtimeAgentId}. */
  runtimeAgentId?: undefined;
}

/**
 * Props for {@link useAgent}.
 *
 * There are exactly two valid shapes, and the type admits nothing in between:
 *
 * - **Bind to an agent** — `useAgent()`, `useAgent({ agentId })`. The shared
 *   instance from the registry; the thread comes from the chat configuration.
 * - **Bind a private agent to a thread** —
 *   `useAgent({ agentId, runtimeAgentId, threadId })`. All three required.
 *
 * So `useAgent({ agentId, threadId })`, `useAgent({ agentId, runtimeAgentId })`,
 * and `useAgent({ runtimeAgentId, threadId })` are all compile errors. Each
 * partial combination is either unsafe (a thread scoped onto a shared singleton)
 * or pointless (a private agent with no thread, or one registered over an id
 * that already belongs to a real agent).
 */
export type UseAgentProps = UseAgentPropsBase &
  (UseAgentThreadScopedProps | UseAgentUnscopedProps);

export function useAgent({
  agentId,
  threadId,
  runtimeAgentId,
  updates,
  throttleMs,
}: UseAgentProps = {}) {
  // Runtime backstop for the all-or-nothing rule UseAgentProps enforces at
  // compile time (plain JS, `as any`, props widened at a call boundary).
  ɵvalidateAgentBinding({ agentId, threadId, runtimeAgentId });

  // Explicit prop, then the surrounding chat configuration (#5533), then the
  // provider default, then DEFAULT_AGENT_ID.
  const chatConfig = useCopilotChatConfiguration();
  const providerAgentId = useDefaultAgentId();
  const resolvedAgentId = ɵresolveAgentId({
    agentId,
    chatAgentId: chatConfig?.agentId,
    providerAgentId,
  });

  const { copilotkit } = useCopilotKit();
  const resolver = ɵgetAgentResolver(copilotkit);
  const revision = useSyncExternalStore(
    resolver.subscribe,
    resolver.getSnapshot,
    resolver.getSnapshot,
  );
  // Read the provider-level default so it appears in the effect's dep array.
  // subscribeToAgentWithOptions reads it from the core instance, but React
  // needs the dep to know when to re-subscribe.
  const providerThrottleMs = copilotkit.defaultThrottleMs;

  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const updateFlags = useMemo(
    () => updates ?? ALL_UPDATES,
    [JSON.stringify(updates)],
  );

  // Thread-scoped path: register a private proxied agent for this hook as one
  // balanced effect (StrictMode-safe: the cleanup unregisters before the
  // remount re-registers). The resolver notifies, so the hook swaps from the
  // provisional stand-in to the real proxy.
  useEffect(() => {
    if (runtimeAgentId == null) return;
    return resolver.bindProxy({ agentId: resolvedAgentId, runtimeAgentId });
  }, [resolver, resolvedAgentId, runtimeAgentId]);

  // Keyed on the header generation, not header values: a builder returning a
  // new token on every resolution must not re-resolve (#1937).
  const headersGeneration = copilotkit.ɵheadersGeneration;
  const { agent, isReady } = useMemo(
    () =>
      resolver.resolve({
        agentId: resolvedAgentId,
        runtimeAgentId,
        caller: "useAgent",
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      resolver,
      revision,
      resolvedAgentId,
      runtimeAgentId,
      copilotkit.agents,
      copilotkit.runtimeConnectionStatus,
      copilotkit.runtimeUrl,
      copilotkit.runtimeTransport,
      copilotkit.credentials,
      headersGeneration,
    ],
  );

  useEffect(
    () =>
      ɵsubscribeToAgentUpdates(copilotkit, agent, {
        updates: updateFlags,
        throttleMs,
        onUpdate: forceUpdate,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent, forceUpdate, throttleMs, providerThrottleMs, updateFlags],
  );

  // Keep request settings fresh outside useMemo: mutating inside it is unsafe
  // in concurrent mode.
  useEffect(() => {
    resolver.refreshRequestSettings(agent);
  }, [resolver, agent, headersGeneration, copilotkit.credentials]);

  // Pin the thread onto the agent. AbstractAgent auto-mints a UUID, so without
  // this the agent ships its own random id in /agent/run, /agent/connect and
  // /agent/stop.
  const resolvedThreadId = ɵresolveAgentThreadId({
    threadId,
    chatThreadId: chatConfig?.threadId,
    chatHasExplicitThreadId: chatConfig?.hasExplicitThreadId,
  });
  useEffect(() => {
    if (!resolvedThreadId) return;
    agent.threadId = resolvedThreadId;
  }, [agent, resolvedThreadId]);

  return {
    agent,
    /**
     * Whether `agent` is the real, runtime-synced (or locally-registered) agent
     * rather than a provisional stand-in returned while the runtime is still
     * connecting (or in an error state).
     *
     * `agent` is always a fully-constructed `AbstractAgent`, so calling
     * `agent.subscribe(...)`, `agent.setState(...)`, etc. is always safe. But
     * while `isReady` is `false` the instance is a placeholder that will be
     * swapped for the real agent once the runtime `/info` sync resolves, at
     * which point `agent` changes reference and dependent effects re-run.
     * Guard on `isReady` when you only want to act against the real agent —
     * e.g. subscribing to run-lifecycle events you don't want to miss during
     * the provisional window (#5000).
     */
    isReady,
  };
}
