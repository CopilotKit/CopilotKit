import type { Signal, WritableSignal } from "@angular/core";
import {
  DestroyRef,
  Injectable,
  inject,
  signal,
  computed,
} from "@angular/core";
import { CopilotKit } from "./copilotkit";
import type { AbstractAgent } from "@ag-ui/client";
import type { AgentSubscriber, Message, State } from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type { CopilotKitCore } from "@copilotkit/core";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";

/** Function signature for subscribing to an agent — derived from
 *  CopilotKitCore so the types stay in sync automatically. Injected
 *  by the factory so that AgentStore stays decoupled from the concrete class. */
type SubscribeToAgentFn = CopilotKitCore["subscribeToAgentWithOptions"];
type AgentWithHeaders = AbstractAgent & { headers?: Record<string, string> };

function hasAgentHeaders(agent: AbstractAgent): agent is AgentWithHeaders {
  return "headers" in agent;
}

export class AgentStore {
  readonly #subscription?: {
    unsubscribe: () => void;
  };
  readonly #isRunning: WritableSignal<boolean>;
  readonly #messages: WritableSignal<Message[]>;
  readonly #state: WritableSignal<unknown>;

  readonly agent: AbstractAgent;
  readonly isRunning: Signal<boolean>;
  readonly messages: Signal<Message[]>;
  readonly state: Signal<unknown>;

  constructor(
    abstractAgent: AbstractAgent,
    destroyRef: DestroyRef,
    subscribeToAgent: SubscribeToAgentFn,
  ) {
    this.agent = abstractAgent;
    // A connected agent can already carry restored thread data before this
    // store subscribes. Seed the signals synchronously so the first render is
    // complete instead of waiting for a future mutation that may never occur.
    this.#isRunning = signal(abstractAgent.isRunning);
    this.isRunning = this.#isRunning.asReadonly();
    this.#messages = signal([...abstractAgent.messages]);
    this.#state = signal(snapshotState(abstractAgent.state));
    this.messages = this.#messages.asReadonly();
    this.state = this.#state.asReadonly();

    this.#subscription = subscribeToAgent(abstractAgent, {
      onMessagesChanged: () => {
        this.#isRunning.set(abstractAgent.isRunning);
        this.#messages.set([...abstractAgent.messages]);
      },
      onStateChanged: () => {
        this.#isRunning.set(abstractAgent.isRunning);
        this.#state.set(snapshotState(abstractAgent.state));
      },
      onRunInitialized: () => {
        this.#isRunning.set(true);
      },
      onRunFinalized: () => {
        this.#isRunning.set(false);
      },
      onRunFailed: () => {
        this.#isRunning.set(false);
      },
      // Protocol-level RUN_ERROR event (distinct from onRunFailed which
      // handles local exceptions like network errors).
      onRunErrorEvent: () => {
        this.#isRunning.set(false);
      },
    });

    destroyRef.onDestroy(() => {
      this.teardown();
    });
  }

  teardown(): void {
    if (this.#subscription) {
      this.#subscription.unsubscribe();
    }
  }
}

function snapshotState(state: unknown): unknown {
  if (Array.isArray(state)) return [...state];
  if (state !== null && typeof state === "object") return { ...state };
  return state;
}

@Injectable({ providedIn: "root" })
export class CopilotkitAgentFactory {
  readonly #copilotkit = inject(CopilotKit);
  readonly #provisionalCache = new Map<string, AgentHandoffBridge>();

  createAgentStoreSignal(
    agentId: Signal<string | undefined>,
    destroyRef: DestroyRef,
  ): Signal<AgentStore> {
    let lastAgentStore: AgentStore | undefined;
    let lastAgent: AbstractAgent | undefined;
    const subscribeToAgent: SubscribeToAgentFn =
      this.#copilotkit.core.subscribeToAgentWithOptions.bind(
        this.#copilotkit.core,
      );

    const resolveAgent = (): AbstractAgent => {
      const resolvedAgentId = agentId() || DEFAULT_AGENT_ID;
      const existing = this.#copilotkit.getAgent(resolvedAgentId);
      if (existing) {
        const handoff = this.#provisionalCache.get(resolvedAgentId);
        if (handoff && handoff.provisional !== existing) {
          handoff.attachRegistered(existing);
        }
        this.#provisionalCache.delete(resolvedAgentId);
        return existing;
      }

      const runtimeUrl = this.#copilotkit.runtimeUrl();
      const isRuntimeConfigured = runtimeUrl !== undefined;
      const { runtimeConnectionStatus } = this.#copilotkit.core;

      if (
        isRuntimeConfigured &&
        (runtimeConnectionStatus ===
          CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
          runtimeConnectionStatus ===
            CopilotKitCoreRuntimeConnectionStatus.Connecting ||
          runtimeConnectionStatus ===
            CopilotKitCoreRuntimeConnectionStatus.Error)
      ) {
        const headers = this.#copilotkit.headers();
        const cached = this.#provisionalCache.get(resolvedAgentId);
        if (cached) {
          if (hasAgentHeaders(cached.provisional)) {
            cached.provisional.headers = { ...headers };
          }
          return cached.provisional;
        }

        const provisional = new ProxiedCopilotRuntimeAgent({
          runtimeUrl,
          agentId: resolvedAgentId,
          transport: this.#copilotkit.runtimeTransport(),
        });
        if (hasAgentHeaders(provisional)) {
          provisional.headers = { ...headers };
        }
        const handoff = new AgentHandoffBridge(provisional);
        this.#provisionalCache.set(resolvedAgentId, handoff);
        return provisional;
      }

      const knownAgents = Object.keys(this.#copilotkit.agents() ?? {});
      const runtimePart = isRuntimeConfigured
        ? `runtimeUrl=${runtimeUrl}`
        : "no runtimeUrl";
      throw new Error(
        `injectAgentStore: Agent '${resolvedAgentId}' not found after runtime sync (${runtimePart}). ` +
          (knownAgents.length
            ? `Known agents: [${knownAgents.join(", ")}]`
            : "No agents registered.") +
          " Verify your runtime /info and/or agents__unsafe_dev_only.",
      );
    };

    return computed(() => {
      this.#copilotkit.agents();
      this.#copilotkit.runtimeConnectionStatus();
      this.#copilotkit.runtimeUrl();
      this.#copilotkit.runtimeTransport();
      this.#copilotkit.headers();

      const agent = resolveAgent();

      if (lastAgentStore && lastAgent === agent) {
        return lastAgentStore;
      }

      lastAgentStore?.teardown();
      lastAgent = agent;
      lastAgentStore = new AgentStore(agent, destroyRef, subscribeToAgent);
      const resolvedAgentId = agentId() || DEFAULT_AGENT_ID;
      const handoff = this.#provisionalCache.get(resolvedAgentId);
      if (handoff?.provisional === agent) {
        handoff.start();
      }
      return lastAgentStore;
    });
  }
}

type HandoffSide = "provisional" | "registered";
type HandoffChannel = "messages" | "state";

class AgentHandoffBridge {
  readonly #provisional: AbstractAgent;
  #provisionalSubscription?: { unsubscribe: () => void };
  #registered?: AbstractAgent;
  #registeredSubscription?: { unsubscribe: () => void };
  readonly #suppressed: Record<HandoffSide, Record<HandoffChannel, number>> = {
    provisional: { messages: 0, state: 0 },
    registered: { messages: 0, state: 0 },
  };

  constructor(provisional: AbstractAgent) {
    this.#provisional = provisional;
  }

  get provisional(): AbstractAgent {
    return this.#provisional;
  }

  /**
   * Subscribe before a provisional run starts. AG-UI snapshots subscribers at
   * run initialization, so a bridge added only after runtime discovery cannot
   * observe the remainder of an already-active run. Re-subscribing after each
   * store is created also keeps the bridge last in the live subscriber list,
   * so mirrored updates reach every consumer synchronously before suppression.
   */
  start(): void {
    this.#provisionalSubscription?.unsubscribe();
    this.#provisionalSubscription = this.#provisional.subscribe(
      this.#subscriber(
        this.#provisional,
        () => this.#registered,
        "provisional",
        "registered",
      ),
    );
  }

  /** Attach the identity published by runtime discovery and synchronize it. */
  attachRegistered(registered: AbstractAgent): void {
    if (this.#registered === registered) return;
    this.#registeredSubscription?.unsubscribe();
    this.#registered = registered;
    this.#registeredSubscription = registered.subscribe(
      this.#subscriber(
        registered,
        () => this.#provisional,
        "registered",
        "provisional",
      ),
    );

    if (hasAgentSessionData(this.#provisional)) {
      this.#mirrorMessages(this.#provisional, registered, "registered");
      this.#mirrorState(this.#provisional, registered, "registered");
      return;
    }

    this.#mirrorMessages(registered, this.#provisional, "provisional");
    this.#mirrorState(registered, this.#provisional, "provisional");
  }

  #subscriber(
    source: AbstractAgent,
    resolveTarget: () => AbstractAgent | undefined,
    sourceSide: HandoffSide,
    targetSide: HandoffSide,
  ): AgentSubscriber {
    const mirrorRunStatus = (): void => {
      const target = resolveTarget();
      if (!target) return;
      this.#mirrorRunStatus(source, target, targetSide);
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
  ): void {
    this.#suppress(targetSide, "messages");
    this.#syncMetadata(source, target);
    target.setMessages([...source.messages]);
  }

  #mirrorState(
    source: AbstractAgent,
    target: AbstractAgent,
    targetSide: HandoffSide,
  ): void {
    this.#suppress(targetSide, "state");
    this.#syncMetadata(source, target);
    target.setState(snapshotState(source.state) as State);
  }

  #mirrorRunStatus(
    source: AbstractAgent,
    target: AbstractAgent,
    targetSide: HandoffSide,
  ): void {
    this.#suppress(targetSide, "state");
    this.#syncMetadata(source, target);
    target.setState(snapshotState(target.state) as State);
  }

  #syncMetadata(source: AbstractAgent, target: AbstractAgent): void {
    target.isRunning = source.isRunning;
    target.threadId = source.threadId;
  }

  #suppress(side: HandoffSide, channel: HandoffChannel): void {
    this.#suppressed[side][channel]++;
  }

  #consumeSuppression(side: HandoffSide, channel: HandoffChannel): boolean {
    if (this.#suppressed[side][channel] === 0) return false;
    this.#suppressed[side][channel]--;
    return true;
  }
}

/** Return whether a provisional agent already owns observable session data. */
function hasAgentSessionData(agent: AbstractAgent): boolean {
  if (agent.isRunning || agent.messages.length > 0) return true;
  const state = agent.state;
  return (
    state !== null && typeof state === "object" && Object.keys(state).length > 0
  );
}

export function injectAgentStore(
  agentId: string | Signal<string | undefined>,
): Signal<AgentStore> {
  const agentFactory = inject(CopilotkitAgentFactory);
  const destroyRef = inject(DestroyRef);
  const agentIdSignal =
    typeof agentId === "function" ? agentId : computed(() => agentId);

  return agentFactory.createAgentStoreSignal(agentIdSignal, destroyRef);
}
