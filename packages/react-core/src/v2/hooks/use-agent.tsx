import { useCopilotKit } from "../context";
import {
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { SubscribeToAgentSubscriber } from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
import type { ReactEphemeralMessage } from "../types/react-custom-message-renderer";

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

type UseAgentChatScope = {
  agentId: string;
  threadId: string;
  hasExplicitThreadId: boolean;
};

export function useAgent(
  {
    agentId,
    threadId,
    runtimeAgentId,
    updates,
    throttleMs,
  }: UseAgentProps = {},
  chatScope?: UseAgentChatScope,
) {
  // `threadId` and `runtimeAgentId` are all-or-nothing. UseAgentProps already
  // rejects a lone one at compile time; these are the runtime backstop for
  // callers TypeScript doesn't cover — plain JS, `as any`, and props widened to
  // `string | undefined` at a call boundary. Fail loud rather than silently
  // mutating shared state or registering an agent that buys nothing.
  //
  // A threadId is written onto a single agent instance. An agent resolved by
  // `agentId` alone is a shared singleton, so a per-hook threadId there would
  // let two useAgent calls with the same agentId clobber each other's thread.
  // runtimeAgentId is what lets the hook register a *private* proxied agent
  // (below) and scope the threadId to that instead.
  if (threadId != null && runtimeAgentId == null) {
    throw new Error(
      `useAgent: \`threadId\` requires \`runtimeAgentId\`. A threadId is written onto a ` +
        `single agent, but an agent resolved by agentId alone is shared, so scoping a ` +
        `thread to it would clobber other useAgent callers. Pass a distinct local \`agentId\` ` +
        `and the runtime agent to route to, e.g. ` +
        `useAgent({ agentId: "chat-1", runtimeAgentId: "${agentId ?? "default"}", threadId }).`,
    );
  }

  // The converse: registering a private proxied agent is only worth doing in
  // order to scope a thread to it. Without a threadId the proxy would source its
  // thread from the chat configuration — exactly what binding to the shared
  // agent by `agentId` already does, minus a registration and a local id the
  // caller has to keep unique. Reject it rather than let it look meaningful.
  if (runtimeAgentId != null && threadId == null) {
    throw new Error(
      `useAgent: \`runtimeAgentId\` requires \`threadId\`. A proxied agent exists to scope a ` +
        `thread to a private instance; without a threadId it behaves like the shared agent ` +
        `while adding a registration and a local agentId to keep unique. Either pass the ` +
        `thread, e.g. useAgent({ agentId: "${agentId ?? "chat-1"}", runtimeAgentId: "${runtimeAgentId}", threadId }), ` +
        `or bind to the agent directly with useAgent({ agentId: "${runtimeAgentId}" }).`,
    );
  }

  // A proxied agent needs a local id of its own. Without an explicit `agentId`
  // the resolution below falls back to the chat configuration's agentId and then
  // DEFAULT_AGENT_ID — ids that already belong to real agents, so registering a
  // proxy over one either throws `already registered` or silently shadows it,
  // depending on whether runtime discovery has landed. Demand the caller name it.
  if (runtimeAgentId != null && agentId == null) {
    throw new Error(
      `useAgent: \`runtimeAgentId\` requires an explicit \`agentId\`. The proxied agent is ` +
        `registered under \`agentId\`, and the usual fallbacks (chat configuration, then ` +
        `"${DEFAULT_AGENT_ID}") name agents that already exist — registering over one throws or ` +
        `shadows it. Pick a local id for this hook, e.g. ` +
        `useAgent({ agentId: "chat-1", runtimeAgentId: "${runtimeAgentId}", threadId }).`,
    );
  }

  // Resolve agentId mirroring CopilotChat's precedence: an explicit prop wins,
  // then the surrounding chat configuration's agentId, then the global default.
  // Without the chat-config fallback, a useAgent() consumer rendered inside a
  // <CopilotChat agentId="..."> subtree resolves to 'default' and throws once
  // the runtime has synced only a non-default agent (#5533).
  const chatConfig = useCopilotChatConfiguration();
  const resolvedAgentId =
    chatScope?.agentId ?? agentId ?? chatConfig?.agentId ?? DEFAULT_AGENT_ID;

  const { copilotkit } = useCopilotKit();
  // Read the provider-level default so it appears in the effect's dep array.
  // subscribeToAgentWithOptions reads it from the core instance, but React needs the dep
  // to know when to re-subscribe.
  const providerThrottleMs = copilotkit.defaultThrottleMs;

  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const updateFlags = useMemo(
    () => updates ?? ALL_UPDATES,
    [JSON.stringify(updates)],
  );

  // Cache provisional agents to avoid creating new references on every render
  // while the runtime is still connecting. A new reference would cascade into
  // CopilotChat's connectAgent effect, causing unnecessary HTTP calls.
  const provisionalAgentCache = useRef<Map<string, ProxiedCopilotRuntimeAgent>>(
    new Map(),
  );

  // When runtimeAgentId is set, this hook owns a proxied agent registered under
  // `resolvedAgentId` that routes to `runtimeAgentId`. Register/unregister as a
  // single balanced effect (StrictMode-safe: the cleanup unregisters before the
  // remount re-registers). Exposing the registered agent via state re-renders
  // the hook so it swaps from the provisional stand-in to the real proxy
  // deterministically, without depending on the provider's agents-changed
  // subscription.
  const [registeredProxyAgent, setRegisteredProxyAgent] =
    useState<AbstractAgent | null>(null);
  useEffect(() => {
    if (runtimeAgentId == null) {
      setRegisteredProxyAgent(null);
      return;
    }
    const { agent: proxy, unregister } = copilotkit.registerProxiedAgent({
      agentId: resolvedAgentId,
      runtimeAgentId,
    });
    provisionalAgentCache.current.delete(resolvedAgentId);
    setRegisteredProxyAgent(proxy);
    return () => {
      unregister();
      setRegisteredProxyAgent(null);
    };
  }, [copilotkit, resolvedAgentId, runtimeAgentId]);

  const { agent, isReady } = useMemo<{
    agent: AbstractAgent;
    isReady: boolean;
  }>(() => {
    // Proxied-agent path: this hook registers its own agent (routing to
    // runtimeAgentId), so bypass the shared-singleton lookup entirely. Use the
    // registered instance once the effect has run; until then return a
    // provisional proxy so `agent` is never null and its reference stays stable
    // across the pre-registration renders.
    if (runtimeAgentId != null) {
      if (registeredProxyAgent) {
        provisionalAgentCache.current.delete(resolvedAgentId);
        return { agent: registeredProxyAgent, isReady: true };
      }
      const cached = provisionalAgentCache.current.get(resolvedAgentId);
      if (cached) {
        copilotkit.applyHeadersToAgent(cached);
        return { agent: cached, isReady: false };
      }
      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId: resolvedAgentId,
        runtimeAgentId,
        transport: copilotkit.runtimeTransport,
        runtimeMode: "pending",
      });
      copilotkit.applyHeadersToAgent(provisional);
      provisionalAgentCache.current.set(resolvedAgentId, provisional);
      return { agent: provisional, isReady: false };
    }

    const existing = copilotkit.getAgent(resolvedAgentId);
    if (existing) {
      // Real agent found — clear any cached provisional for this ID
      provisionalAgentCache.current.delete(resolvedAgentId);
      return { agent: existing, isReady: true };
    }

    const isRuntimeConfigured = copilotkit.runtimeUrl !== undefined;
    const status = copilotkit.runtimeConnectionStatus;

    // While runtime is not yet synced, return a provisional runtime agent
    if (
      isRuntimeConfigured &&
      (status === CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
        status === CopilotKitCoreRuntimeConnectionStatus.Connecting)
    ) {
      // Return cached provisional if available (keeps reference stable)
      const cached = provisionalAgentCache.current.get(resolvedAgentId);
      if (cached) {
        return { agent: cached, isReady: false };
      }

      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId: resolvedAgentId,
        transport: copilotkit.runtimeTransport,
        credentials: copilotkit.credentials,
        runtimeMode: "pending",
      });
      // Apply current headers so runs/connects inherit them
      copilotkit.applyHeadersToAgent(provisional);
      provisionalAgentCache.current.set(resolvedAgentId, provisional);
      return { agent: provisional, isReady: false };
    }

    // Runtime is in Error state — return a provisional agent instead of throwing.
    // The error has already been emitted through the subscriber system
    // (RUNTIME_INFO_FETCH_FAILED). Throwing here would crash the React tree;
    // returning a provisional agent lets onError handlers fire while keeping
    // the app alive.
    if (
      isRuntimeConfigured &&
      status === CopilotKitCoreRuntimeConnectionStatus.Error
    ) {
      const cached = provisionalAgentCache.current.get(resolvedAgentId);
      if (cached) {
        return { agent: cached, isReady: false };
      }
      const provisional = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: copilotkit.runtimeUrl,
        agentId: resolvedAgentId,
        transport: copilotkit.runtimeTransport,
        credentials: copilotkit.credentials,
        runtimeMode: "pending",
      });
      copilotkit.applyHeadersToAgent(provisional);
      provisionalAgentCache.current.set(resolvedAgentId, provisional);
      return { agent: provisional, isReady: false };
    }

    // No runtime configured and agent doesn't exist — this is a configuration error.
    const knownAgents = Object.keys(copilotkit.agents ?? {});
    const runtimePart = isRuntimeConfigured
      ? `runtimeUrl=${copilotkit.runtimeUrl}`
      : "no runtimeUrl";
    throw new Error(
      `useAgent: Agent '${resolvedAgentId}' not found after runtime sync (${runtimePart}). ` +
        (knownAgents.length
          ? `Known agents: [${knownAgents.join(", ")}]`
          : "No agents registered.") +
        " Verify your runtime /info and/or agents__unsafe_dev_only.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resolvedAgentId,
    runtimeAgentId,
    registeredProxyAgent,
    copilotkit.agents,
    copilotkit.runtimeConnectionStatus,
    copilotkit.runtimeUrl,
    copilotkit.runtimeTransport,
    copilotkit.credentials,
    JSON.stringify(copilotkit.headers),
  ]);

  useEffect(() => {
    if (updateFlags.length === 0) return;

    let active = true;
    const handlers: SubscribeToAgentSubscriber = {};

    // Microtask-batched forceUpdate: coalesces multiple synchronous
    // notifications (e.g. OnStateChanged + OnRunStatusChanged firing in the
    // same tick) into a single React re-render. This prevents the scroll
    // jumping described in #3499 where rapid unbatched forceUpdate calls
    // cause brief content height fluctuations during streaming.
    let batchScheduled = false;
    const batchedForceUpdate = () => {
      if (!active) return;
      if (!batchScheduled) {
        batchScheduled = true;
        queueMicrotask(() => {
          batchScheduled = false;
          if (active) {
            forceUpdate();
          }
        });
      }
    };

    if (updateFlags.includes(UseAgentUpdate.OnMessagesChanged)) {
      handlers.onMessagesChanged = batchedForceUpdate;
    }

    if (updateFlags.includes(UseAgentUpdate.OnStateChanged)) {
      handlers.onStateChanged = batchedForceUpdate;
    }

    if (updateFlags.includes(UseAgentUpdate.OnRunStatusChanged)) {
      handlers.onRunInitialized = batchedForceUpdate;
      handlers.onRunFinalized = batchedForceUpdate;
      handlers.onRunFailed = batchedForceUpdate;
      // Protocol-level RUN_ERROR event (distinct from onRunFailed which
      // handles local exceptions like network errors).
      handlers.onRunErrorEvent = batchedForceUpdate;
    }

    const subscription = copilotkit.subscribeToAgentWithOptions(
      agent,
      handlers,
      {
        throttleMs,
      },
    );
    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, forceUpdate, throttleMs, providerThrottleMs, updateFlags]);

  // Keep HttpAgent request settings fresh without mutating inside useMemo,
  // which is unsafe in concurrent mode (React may invoke useMemo multiple
  // times and discard intermediate results, but mutations always land).
  useEffect(() => {
    if (agent instanceof HttpAgent) {
      // Merge core headers on top of the agent's own headers rather than
      // replacing them, so per-agent headers (e.g. an Authorization for a
      // self-hosted backend) are preserved (see #5635).
      copilotkit.applyHeadersToAgent(agent);
    }
    if (agent instanceof ProxiedCopilotRuntimeAgent) {
      agent.credentials = copilotkit.credentials;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, JSON.stringify(copilotkit.headers), copilotkit.credentials]);

  // Propagate the caller-supplied threadId onto the agent. AbstractAgent's
  // constructor auto-mints a UUID when no threadId is passed, so without this
  // sync the agent ships its own random UUID in /agent/run, /agent/connect,
  // /agent/stop — diverging from the threadId the app code intends.
  //
  // Resolution precedence:
  //   1. An explicit `threadId` prop always wins. This lets headless callers
  //      (e.g. React Native) scope the run to a thread without a
  //      <CopilotChatConfigurationProvider> in the tree.
  //   2. Otherwise fall back to the chat configuration's threadId, gated on
  //      hasExplicitThreadId so a ThreadsProvider-minted placeholder UUID
  //      doesn't overwrite the auto-minted agent UUID (both are random and
  //      useless to the backend; the explicit gate keeps the agent's UUID
  //      stable across renders).
  const configThreadId = chatScope?.threadId ?? chatConfig?.threadId;
  const configHasExplicitThreadId =
    chatScope?.hasExplicitThreadId ?? chatConfig?.hasExplicitThreadId;
  const resolvedThreadId =
    threadId ?? (configHasExplicitThreadId ? configThreadId : undefined);
  const previousResolvedThreadIdRef = useRef(resolvedThreadId);
  useEffect(() => {
    if (!resolvedThreadId) return;
    const threadChanged =
      previousResolvedThreadIdRef.current !== resolvedThreadId;
    previousResolvedThreadIdRef.current = resolvedThreadId;
    agent.threadId = resolvedThreadId;
    if (threadChanged && agent.messages.length > 0) {
      agent.setMessages([]);
    }
  }, [agent, resolvedThreadId]);

  const ephemeralThreadId =
    resolvedThreadId ?? configThreadId ?? agent.threadId;
  const ephemeralScopeRef = useRef({
    agentId: resolvedAgentId,
    threadId: ephemeralThreadId,
  });
  useLayoutEffect(() => {
    ephemeralScopeRef.current = {
      agentId: resolvedAgentId,
      threadId: ephemeralThreadId,
    };
  }, [ephemeralThreadId, resolvedAgentId]);

  useEffect(() => {
    const reconcile = () => {
      if (agent.threadId !== ephemeralThreadId) return;
      copilotkit.reconcileEphemeralMessages(
        resolvedAgentId,
        ephemeralThreadId,
        agent.messages,
      );
    };

    reconcile();
    const subscription = agent.subscribe({
      onMessagesChanged: reconcile,
    });
    return () => subscription.unsubscribe();
  }, [agent, copilotkit, ephemeralThreadId, resolvedAgentId]);

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onEphemeralMessagesChanged: ({
        agentId: eventAgentId,
        threadId: eventThreadId,
      }) => {
        const currentThreadId =
          resolvedThreadId ?? configThreadId ?? agent.threadId;
        if (
          eventAgentId === resolvedAgentId &&
          eventThreadId === currentThreadId
        ) {
          forceUpdate();
        }
      },
    });
    return () => subscription.unsubscribe();
  }, [
    agent,
    configThreadId,
    copilotkit,
    ephemeralThreadId,
    forceUpdate,
    resolvedAgentId,
    resolvedThreadId,
  ]);

  const addEphemeralMessage = useCallback(
    (message: ReactEphemeralMessage): boolean => {
      const currentScope = ephemeralScopeRef.current;
      if (
        currentScope.agentId !== resolvedAgentId ||
        currentScope.threadId !== ephemeralThreadId
      ) {
        return false;
      }
      return copilotkit.addEphemeralMessage(
        currentScope.agentId,
        currentScope.threadId,
        message,
      );
    },
    [copilotkit, ephemeralThreadId, resolvedAgentId],
  );

  const removeEphemeralMessage = useCallback(
    (messageId: string): boolean => {
      const currentScope = ephemeralScopeRef.current;
      if (
        currentScope.agentId !== resolvedAgentId ||
        currentScope.threadId !== ephemeralThreadId
      ) {
        return false;
      }
      return copilotkit.removeEphemeralMessage(
        currentScope.agentId,
        currentScope.threadId,
        messageId,
      );
    },
    [copilotkit, ephemeralThreadId, resolvedAgentId],
  );

  const clearEphemeralMessages = useCallback((): boolean => {
    const currentScope = ephemeralScopeRef.current;
    if (
      currentScope.agentId !== resolvedAgentId ||
      currentScope.threadId !== ephemeralThreadId
    ) {
      return false;
    }
    return copilotkit.clearEphemeralMessages(
      currentScope.agentId,
      currentScope.threadId,
    );
  }, [copilotkit, ephemeralThreadId, resolvedAgentId]);

  const ephemeralMessages = copilotkit.getEphemeralMessages(
    resolvedAgentId,
    ephemeralThreadId,
  );

  return {
    agent,
    ephemeralMessages,
    addEphemeralMessage,
    removeEphemeralMessage,
    clearEphemeralMessages,
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
