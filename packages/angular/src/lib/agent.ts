import {
  DestroyRef,
  Injectable,
  inject,
  signal,
  computed,
  Signal,
} from "@angular/core";
import { CopilotKit } from "./copilotkit";
import type { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import {
  CopilotKitCore,
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";

/** Function signature for subscribing to an agent — derived from
 *  CopilotKitCore so the types stay in sync automatically. Injected
 *  by the factory so that AgentStore stays decoupled from the concrete class. */
type SubscribeToAgentFn = CopilotKitCore["subscribeToAgentWithOptions"];

export class AgentStore {
  readonly #subscription?: {
    unsubscribe: () => void;
  };
  readonly #isRunning = signal<boolean>(false);
  readonly #messages = signal<Message[]>([]);
  readonly #state = signal<any>(undefined);

  readonly agent: AbstractAgent;
  readonly isRunning = this.#isRunning.asReadonly();
  readonly messages = this.#messages.asReadonly();
  readonly state = this.#state.asReadonly();

  constructor(
    abstractAgent: AbstractAgent,
    destroyRef: DestroyRef,
    subscribeToAgent: SubscribeToAgentFn,
  ) {
    this.agent = abstractAgent;

    this.#subscription = subscribeToAgent(abstractAgent, {
      onMessagesChanged: () => {
        this.#messages.set(abstractAgent.messages);
      },
      onStateChanged: () => {
        this.#state.set(abstractAgent.state);
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

@Injectable({ providedIn: "root" })
export class CopilotkitAgentFactory {
  readonly #copilotkit = inject(CopilotKit);

  createAgentStoreSignal(
    agentId: Signal<string | undefined>,
    destroyRef: DestroyRef,
  ): Signal<AgentStore> {
    let lastAgentStore: AgentStore | undefined;
    const subscribeToAgent: SubscribeToAgentFn =
      this.#copilotkit.core.subscribeToAgentWithOptions.bind(
        this.#copilotkit.core,
      );

    return computed(() => {
      this.#copilotkit.agents();
      this.#copilotkit.runtimeConnectionStatus();
      const runtimeUrl = this.#copilotkit.runtimeUrl();
      const runtimeTransport = this.#copilotkit.runtimeTransport();
      const headers = this.#copilotkit.headers();

      if (lastAgentStore) {
        lastAgentStore.teardown();
        lastAgentStore = undefined;
      }

      const resolvedAgentId = agentId() || DEFAULT_AGENT_ID;
      const abstractAgent = this.#copilotkit.getAgent(resolvedAgentId);
      if (!abstractAgent) {
        const { runtimeConnectionStatus } = this.#copilotkit.core;
        const isRuntimeConfigured = runtimeUrl !== undefined;

        if (
          isRuntimeConfigured &&
          (runtimeConnectionStatus ===
            CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
            runtimeConnectionStatus ===
              CopilotKitCoreRuntimeConnectionStatus.Connecting ||
            runtimeConnectionStatus ===
              CopilotKitCoreRuntimeConnectionStatus.Error)
        ) {
          const provisional = new ProxiedCopilotRuntimeAgent({
            runtimeUrl,
            agentId: resolvedAgentId,
            transport: runtimeTransport,
          });
          // Apply current headers so runs/connects inherit them

          (provisional as any).headers = { ...headers };
          lastAgentStore = new AgentStore(
            provisional,
            destroyRef,
            subscribeToAgent,
          );
          return lastAgentStore;
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
      }

      lastAgentStore = new AgentStore(
        abstractAgent,
        destroyRef,
        subscribeToAgent,
      );
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
