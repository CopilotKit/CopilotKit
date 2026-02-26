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
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkitnext/core";

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

  constructor(abstractAgent: AbstractAgent, destroyRef: DestroyRef) {
    this.agent = abstractAgent;

    this.#subscription = abstractAgent.subscribe({
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
              CopilotKitCoreRuntimeConnectionStatus.Connecting)
        ) {
          const provisional = new ProxiedCopilotRuntimeAgent({
            runtimeUrl,
            agentId: resolvedAgentId,
            transport: runtimeTransport,
          });
          // Apply current headers so runs/connects inherit them
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (provisional as any).headers = { ...headers };
          lastAgentStore = new AgentStore(provisional, destroyRef);
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

      lastAgentStore = new AgentStore(abstractAgent, destroyRef);
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
