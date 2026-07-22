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
import type { Message } from "@ag-ui/client";
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
  readonly #isRunning = signal<boolean>(false);
  readonly #messages: WritableSignal<Message[]>;
  readonly #state: WritableSignal<unknown>;

  readonly agent: AbstractAgent;
  readonly isRunning = this.#isRunning.asReadonly();
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
    this.#messages = signal([...abstractAgent.messages]);
    this.#state = signal(snapshotState(abstractAgent.state));
    this.messages = this.#messages.asReadonly();
    this.state = this.#state.asReadonly();

    this.#subscription = subscribeToAgent(abstractAgent, {
      onMessagesChanged: () => {
        this.#messages.set([...abstractAgent.messages]);
      },
      onStateChanged: () => {
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
  readonly #provisionalCache = new Map<string, ProxiedCopilotRuntimeAgent>();

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
          if (hasAgentHeaders(cached)) {
            cached.headers = { ...headers };
          }
          return cached;
        }

        const provisional = new ProxiedCopilotRuntimeAgent({
          runtimeUrl,
          agentId: resolvedAgentId,
          transport: this.#copilotkit.runtimeTransport(),
        });
        if (hasAgentHeaders(provisional)) {
          provisional.headers = { ...headers };
        }
        this.#provisionalCache.set(resolvedAgentId, provisional);
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
      return lastAgentStore;
    });
  }
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
