import type { AbstractAgent, AgentSubscriber, State } from "@ag-ui/client";
import { DEFAULT_AGENT_ID, resolveDebugConfig } from "@copilotkit/shared";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { ɵisHttpAgent } from "../utils/http-agent";
import type { CopilotKitCore, SubscribeToAgentSubscriber } from "./core";
import { CopilotKitCoreRuntimeConnectionStatus } from "./core";

/**
 * Agent binding shared by React `useAgent`, Vue `useAgent` and Angular
 * `injectAgentStore`: which agent a hook binds to, the stand-in it uses while
 * the runtime `/info` sync is still running, and the hand-off from that
 * stand-in to the real agent once it lands.
 *
 * Everything here is internal (`ɵ`) and can change in any release.
 */

/** The props that pick a thread-scoped (private, proxied) agent. */
export interface ɵAgentBindingInput {
  agentId?: string;
  threadId?: string;
  runtimeAgentId?: string;
}

/**
 * Throw when `threadId`, `runtimeAgentId` and an explicit `agentId` are not
 * given as an all-or-nothing set. Type definitions reject a partial set; this
 * is the runtime backstop for plain JS and widened props.
 *
 * - A `threadId` alone would be written onto a shared agent and clobber other
 *   callers.
 * - A `runtimeAgentId` alone registers a private agent that buys nothing.
 * - A `runtimeAgentId` without an explicit `agentId` would register over an
 *   agent that already exists.
 */
export function ɵvalidateAgentBinding({
  agentId,
  threadId,
  runtimeAgentId,
}: ɵAgentBindingInput) {
  if (threadId != null && runtimeAgentId == null) {
    throw new Error(
      `useAgent: \`threadId\` requires \`runtimeAgentId\`. A threadId is written onto a ` +
        `single agent, but an agent resolved by agentId alone is shared, so scoping a ` +
        `thread to it would clobber other useAgent callers. Pass a distinct local \`agentId\` ` +
        `and the runtime agent to route to, e.g. ` +
        `useAgent({ agentId: "chat-1", runtimeAgentId: "${agentId ?? "default"}", threadId }).`,
    );
  }

  if (runtimeAgentId != null && threadId == null) {
    throw new Error(
      `useAgent: \`runtimeAgentId\` requires \`threadId\`. A proxied agent exists to scope a ` +
        `thread to a private instance; without a threadId it behaves like the shared agent ` +
        `while adding a registration and a local agentId to keep unique. Either pass the ` +
        `thread, e.g. useAgent({ agentId: "${agentId ?? "chat-1"}", runtimeAgentId: "${runtimeAgentId}", threadId }), ` +
        `or bind to the agent directly with useAgent({ agentId: "${runtimeAgentId}" }).`,
    );
  }

  if (runtimeAgentId != null && agentId == null) {
    throw new Error(
      `useAgent: \`runtimeAgentId\` requires an explicit \`agentId\`. The proxied agent is ` +
        `registered under \`agentId\`, and the usual fallbacks (chat configuration, then ` +
        `"${DEFAULT_AGENT_ID}") name agents that already exist — registering over one throws or ` +
        `shadows it. Pick a local id for this hook, e.g. ` +
        `useAgent({ agentId: "chat-1", runtimeAgentId: "${runtimeAgentId}", threadId }).`,
    );
  }
}

/**
 * Pick the agent id a hook binds to: the explicit id, then the surrounding
 * chat configuration's id, then the provider default, then
 * `DEFAULT_AGENT_ID`. Without the chat-config step a hook inside a chat for a
 * non-default agent resolves to `default` and throws once the runtime has
 * synced (#5533). Adapters pass the sources they have.
 */
export function ɵresolveAgentId({
  agentId,
  chatAgentId,
  providerAgentId,
}: {
  agentId?: string;
  chatAgentId?: string;
  providerAgentId?: string;
}) {
  return agentId ?? chatAgentId ?? providerAgentId ?? DEFAULT_AGENT_ID;
}

/**
 * Pick the thread to pin on a bound agent: an explicit `threadId` wins,
 * otherwise the chat configuration's thread, but only when that thread was
 * set on purpose. A placeholder UUID would overwrite the agent's own UUID with
 * an equally random one, and the agent's UUID is the one that stays stable.
 */
export function ɵresolveAgentThreadId({
  threadId,
  chatThreadId,
  chatHasExplicitThreadId,
}: {
  threadId?: string;
  chatThreadId?: string;
  chatHasExplicitThreadId?: boolean;
}) {
  return threadId ?? (chatHasExplicitThreadId ? chatThreadId : undefined);
}

/** Copy a state value so a new reference reaches signal / ref consumers. */
export function ɵsnapshotAgentState(state: unknown) {
  if (Array.isArray(state)) return [...state];
  if (state !== null && typeof state === "object") return { ...state };
  return state;
}

/** Return whether an agent already holds messages, state, or a run. */
function hasAgentSessionData(agent: AbstractAgent) {
  if (agent.isRunning || agent.messages.length > 0) return true;
  const state = agent.state;
  return (
    state !== null && typeof state === "object" && Object.keys(state).length > 0
  );
}

type HandoffSide = "provisional" | "registered";
type HandoffChannel = "messages" | "state";

/**
 * Keep a provisional agent and the registered agent that replaces it in sync.
 *
 * A hook can hand out a provisional agent before `/info` lands, and app code
 * can write messages or state into it or start a run on it. When the real
 * agent arrives, this copies that session data across (or, when the
 * provisional is empty, copies the registered agent's restored data back to
 * consumers that still hold the provisional), and keeps mirroring later
 * updates both ways.
 */
class AgentHandoffBridge {
  readonly provisional: AbstractAgent;
  #provisionalSubscription?: { unsubscribe: () => void };
  #registered?: AbstractAgent;
  #registeredSubscription?: { unsubscribe: () => void };
  readonly #suppressed: Record<HandoffSide, Record<HandoffChannel, number>> = {
    provisional: { messages: 0, state: 0 },
    registered: { messages: 0, state: 0 },
  };

  constructor(provisional: AbstractAgent) {
    this.provisional = provisional;
  }

  /**
   * Subscribe before a provisional run starts. AG-UI snapshots subscribers at
   * run initialization, so a bridge added only after runtime discovery cannot
   * observe the rest of a run that is already active. Calling it again moves
   * the bridge to the end of the subscriber list, so every consumer sees a
   * mirrored update before the bridge consumes its suppression.
   */
  start() {
    this.#provisionalSubscription?.unsubscribe();
    this.#provisionalSubscription = this.provisional.subscribe(
      this.#subscriber(
        this.provisional,
        () => this.#registered,
        "provisional",
        "registered",
      ),
    );
  }

  /** Attach the agent published by runtime discovery and sync it. */
  attachRegistered(registered: AbstractAgent) {
    if (this.#registered === registered) return;
    this.#registeredSubscription?.unsubscribe();
    this.#registered = registered;
    this.#registeredSubscription = registered.subscribe(
      this.#subscriber(
        registered,
        () => this.provisional,
        "registered",
        "provisional",
      ),
    );

    if (hasAgentSessionData(this.provisional)) {
      this.#mirrorMessages(this.provisional, registered, "registered");
      this.#mirrorState(this.provisional, registered, "registered");
      return;
    }

    this.#mirrorMessages(registered, this.provisional, "provisional");
    this.#mirrorState(registered, this.provisional, "provisional");
  }

  dispose() {
    this.#provisionalSubscription?.unsubscribe();
    this.#registeredSubscription?.unsubscribe();
    this.#provisionalSubscription = undefined;
    this.#registeredSubscription = undefined;
  }

  #subscriber(
    source: AbstractAgent,
    resolveTarget: () => AbstractAgent | undefined,
    sourceSide: HandoffSide,
    targetSide: HandoffSide,
  ): AgentSubscriber {
    const mirrorRunStatus = () => {
      const target = resolveTarget();
      if (!target) return;
      this.#suppress(targetSide, "state");
      this.#syncMetadata(source, target);
      target.setState(ɵsnapshotAgentState(target.state) as State);
    };
    return {
      onMessagesChanged: () => {
        if (this.#consumeSuppression(sourceSide, "messages")) return;
        const target = resolveTarget();
        if (!target) return;
        this.#mirrorMessages(source, target, targetSide);
      },
      onStateChanged: () => {
        if (this.#consumeSuppression(sourceSide, "state")) return;
        const target = resolveTarget();
        if (!target) return;
        this.#mirrorState(source, target, targetSide);
      },
      onRunInitialized: mirrorRunStatus,
      onRunFinalized: mirrorRunStatus,
      onRunFailed: mirrorRunStatus,
      onRunErrorEvent: mirrorRunStatus,
    };
  }

  #mirrorMessages(
    source: AbstractAgent,
    target: AbstractAgent,
    targetSide: HandoffSide,
  ) {
    this.#suppress(targetSide, "messages");
    this.#syncMetadata(source, target);
    target.setMessages([...source.messages]);
  }

  #mirrorState(
    source: AbstractAgent,
    target: AbstractAgent,
    targetSide: HandoffSide,
  ) {
    this.#suppress(targetSide, "state");
    this.#syncMetadata(source, target);
    target.setState(ɵsnapshotAgentState(source.state) as State);
  }

  #syncMetadata(source: AbstractAgent, target: AbstractAgent) {
    target.isRunning = source.isRunning;
    target.threadId = source.threadId;
  }

  #suppress(side: HandoffSide, channel: HandoffChannel) {
    this.#suppressed[side][channel]++;
  }

  #consumeSuppression(side: HandoffSide, channel: HandoffChannel) {
    if (this.#suppressed[side][channel] === 0) return false;
    this.#suppressed[side][channel]--;
    return true;
  }
}

/** What {@link ɵAgentResolver.resolve} needs to pick an agent. */
export interface ɵAgentResolveInput {
  /** The resolved local agent id (see {@link ɵresolveAgentId}). */
  agentId: string;
  /**
   * Set for a thread-scoped binding: the hook owns a private proxied agent
   * registered under `agentId` (see {@link ɵAgentResolver.bindProxy}).
   */
  runtimeAgentId?: string;
  /** Name used in the not-found error, e.g. `useAgent`. */
  caller: string;
}

/**
 * Resolve the agent a hook binds to, for one `CopilotKitCore`.
 *
 * - A registered agent wins and `isReady` is `true`.
 * - While the runtime is configured and has not synced (or failed), a
 *   provisional `ProxiedCopilotRuntimeAgent` stands in. It is cached by id, so
 *   every consumer of the same id gets the same instance and its reference
 *   stays stable. A new reference would make chats reconnect for nothing.
 * - When the real agent lands, a hand-off bridge copies the session data
 *   written during the `/info` window to it.
 * - Without a runtime, a missing agent is a configuration error and throws.
 *
 * Adapters re-run `resolve()` when the core state it reads changes (agents,
 * connection status, runtime URL / transport, header generation,
 * credentials); they already track that through their own reactivity.
 * `getSnapshot()` returns a revision for the state the resolver owns (proxy
 * registrations from {@link ɵAgentResolver.bindProxy}), and `subscribe()`
 * reports changes to it. Use one resolver per core: {@link ɵgetAgentResolver}.
 */
export class ɵAgentResolver {
  readonly #core: CopilotKitCore;
  readonly #provisional = new Map<string, AgentHandoffBridge>();
  readonly #bridges = new Set<AgentHandoffBridge>();
  readonly #proxies = new Map<string, AbstractAgent>();
  readonly #listeners = new Set<() => void>();
  #revision = 0;

  constructor(core: CopilotKitCore) {
    this.#core = core;
  }

  /** A number that changes when a proxy registration changes. */
  getSnapshot = () => this.#revision;

  /** Listen for proxy registration changes. Returns unsubscribe. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Pick the agent for `agentId`. Calling it again with the same inputs and
   * core state returns the same agent instance.
   *
   * @throws Error when no runtime is configured (or it has synced) and no
   * agent is registered under `agentId`. The message lists known agents.
   */
  resolve({ agentId, runtimeAgentId, caller }: ɵAgentResolveInput) {
    const registered =
      runtimeAgentId == null
        ? this.#core.getAgent(agentId)
        : this.#proxies.get(agentId);
    if (registered) {
      this.#handOff(agentId, registered);
      return { agent: registered, isReady: true };
    }

    if (runtimeAgentId != null) {
      return {
        agent: this.#provisionalAgent(agentId, runtimeAgentId),
        isReady: false,
      };
    }

    const isRuntimeConfigured = this.#core.runtimeUrl !== undefined;
    const status = this.#core.runtimeConnectionStatus;
    const isWaitingForRuntime =
      isRuntimeConfigured &&
      status !== CopilotKitCoreRuntimeConnectionStatus.Connected;
    // Disconnected / Connecting: `/info` has not landed. Error: the failure was
    // already emitted through `onError`; throwing here would crash the UI tree.
    if (isWaitingForRuntime) {
      return { agent: this.#provisionalAgent(agentId), isReady: false };
    }

    const knownAgents = Object.keys(this.#core.agents ?? {});
    const runtimePart = isRuntimeConfigured
      ? `runtimeUrl=${this.#core.runtimeUrl}`
      : "no runtimeUrl";
    throw new Error(
      `${caller}: Agent '${agentId}' not found after runtime sync (${runtimePart}). ` +
        (knownAgents.length
          ? `Known agents: [${knownAgents.join(", ")}]`
          : "No agents registered.") +
        " Verify your runtime /info and/or agents__unsafe_dev_only.",
    );
  }

  /**
   * Register a private proxied agent under `agentId` that routes to
   * `runtimeAgentId`, so `resolve({ agentId, runtimeAgentId })` returns it.
   * Call from a mount effect; the returned function unregisters it.
   */
  bindProxy({
    agentId,
    runtimeAgentId,
  }: {
    agentId: string;
    runtimeAgentId: string;
  }) {
    const { agent, unregister } = this.#core.registerProxiedAgent({
      agentId,
      runtimeAgentId,
    });
    this.#proxies.set(agentId, agent);
    this.#handOff(agentId, agent);
    this.#notify();
    return () => {
      unregister();
      if (this.#proxies.get(agentId) === agent) {
        this.#proxies.delete(agentId);
        this.#notify();
      }
    };
  }

  /**
   * Bring an agent's request settings up to date: the core headers (own
   * headers kept, see #5635) and, for a runtime agent, the credentials mode.
   * Call when the agent, the header generation, or credentials change.
   */
  refreshRequestSettings(agent: AbstractAgent) {
    if (ɵisHttpAgent(agent)) {
      this.#core.applyHeadersToAgent(agent);
    }
    if (agent instanceof ProxiedCopilotRuntimeAgent) {
      agent.credentials = this.#core.credentials;
    }
  }

  /**
   * Move the hand-off bridge of a provisional agent to the end of its
   * subscriber list. Call after subscribing a new consumer to `agent`. Does
   * nothing for an agent that is not provisional.
   */
  retainHandoffOrder(agent: AbstractAgent) {
    for (const bridge of this.#provisional.values()) {
      if (bridge.provisional === agent) bridge.start();
    }
  }

  dispose() {
    for (const bridge of this.#bridges) bridge.dispose();
    this.#bridges.clear();
    this.#provisional.clear();
    this.#proxies.clear();
    this.#listeners.clear();
  }

  #provisionalAgent(agentId: string, runtimeAgentId?: string) {
    const cached = this.#provisional.get(agentId);
    if (cached) {
      // Never invokes the headers builder: installs `ɵruntimeFetch`, which
      // resolves headers at send time (#1937).
      this.refreshRequestSettings(cached.provisional);
      return cached.provisional;
    }
    const core = this.#core;
    // Same settings `registerProxiedAgent` gives a registered proxy, so a run
    // started during the `/info` window behaves like one started after it.
    const provisional = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: core.ɵruntimeEndpointUrl ?? core.runtimeUrl,
      agentId,
      runtimeAgentId,
      transport: core.runtimeTransport,
      credentials: core.credentials,
      runtimeMode: "pending",
      intelligence: core.intelligence,
      debug: core.debug ? resolveDebugConfig(core.debug) : undefined,
      messageFilter: core.messageFilter,
    });
    core.applyHeadersToAgent(provisional);
    const bridge = new AgentHandoffBridge(provisional);
    bridge.start();
    this.#provisional.set(agentId, bridge);
    this.#bridges.add(bridge);
    return provisional;
  }

  #handOff(agentId: string, registered: AbstractAgent) {
    const bridge = this.#provisional.get(agentId);
    if (!bridge) return;
    this.#provisional.delete(agentId);
    if (bridge.provisional === registered) return;
    bridge.attachRegistered(registered);
  }

  #notify() {
    this.#revision++;
    const listeners = [...this.#listeners];
    for (const listener of listeners) listener();
  }
}

const resolvers = new WeakMap<CopilotKitCore, ɵAgentResolver>();

/** The shared {@link ɵAgentResolver} for `core`, created on first use. */
export function ɵgetAgentResolver(core: CopilotKitCore) {
  const existing = resolvers.get(core);
  if (existing) return existing;
  const resolver = new ɵAgentResolver(core);
  resolvers.set(core, resolver);
  return resolver;
}

/** Which agent changes re-render a `useAgent` consumer. */
export type ɵAgentUpdateFlag =
  | "OnMessagesChanged"
  | "OnStateChanged"
  | "OnRunStatusChanged";

/** Every flag, the default for `useAgent`. */
export const ɵALL_AGENT_UPDATES: readonly ɵAgentUpdateFlag[] = [
  "OnMessagesChanged",
  "OnStateChanged",
  "OnRunStatusChanged",
];

/**
 * Map `useAgent` update flags to agent subscriber callbacks that all call
 * `notify`.
 */
export function ɵagentUpdateHandlers(
  flags: readonly ɵAgentUpdateFlag[],
  notify: () => void,
) {
  const handlers: SubscribeToAgentSubscriber = {};
  if (flags.includes("OnMessagesChanged")) {
    handlers.onMessagesChanged = notify;
  }
  if (flags.includes("OnStateChanged")) {
    handlers.onStateChanged = notify;
  }
  if (flags.includes("OnRunStatusChanged")) {
    handlers.onRunInitialized = notify;
    handlers.onRunStartedEvent = notify;
    handlers.onRunFinalized = notify;
    handlers.onRunFailed = notify;
    // Protocol-level RUN_ERROR, distinct from `onRunFailed` (local errors).
    handlers.onRunErrorEvent = notify;
  }
  return handlers;
}

/**
 * Subscribe a framework consumer to an agent: `onUpdate` runs once per
 * microtask however many selected notifications fire in that tick (for
 * example state and run status together), which keeps streaming re-renders
 * from making the scroll height jump (#3499). Throttling of message and state
 * notifications is core's (`subscribeToAgentWithOptions`).
 *
 * Returns the unsubscribe function. Nothing is subscribed for an empty
 * `updates` list.
 */
export function ɵsubscribeToAgentUpdates(
  core: CopilotKitCore,
  agent: AbstractAgent,
  {
    updates,
    throttleMs,
    onUpdate,
  }: {
    updates: readonly ɵAgentUpdateFlag[];
    throttleMs?: number;
    onUpdate: () => void;
  },
) {
  if (updates.length === 0) return () => {};
  let active = true;
  let scheduled = false;
  const notify = () => {
    if (!active || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (active) onUpdate();
    });
  };
  const subscription = core.subscribeToAgentWithOptions(
    agent,
    ɵagentUpdateHandlers(updates, notify),
    { throttleMs },
  );
  return () => {
    active = false;
    subscription.unsubscribe();
  };
}
