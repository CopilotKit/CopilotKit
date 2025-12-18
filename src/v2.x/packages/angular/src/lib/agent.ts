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
    destroyRef: DestroyRef
  ): Signal<AgentStore | undefined> {
    let lastAgentStore: AgentStore | undefined;

    return computed(() => {
      this.#copilotkit.agents();

      if (lastAgentStore) {
        lastAgentStore.teardown();
        lastAgentStore = undefined;
      }

      const abstractAgent = this.#copilotkit.getAgent(
        agentId() || DEFAULT_AGENT_ID
      );
      if (!abstractAgent) return undefined;

      lastAgentStore = new AgentStore(abstractAgent, destroyRef);
      return lastAgentStore;
    });
  }
}

export function injectAgentStore(
  agentId: string | Signal<string | undefined>
): Signal<AgentStore | undefined> {
  const agentFactory = inject(CopilotkitAgentFactory);
  const destroyRef = inject(DestroyRef);
  const agentIdSignal =
    typeof agentId === "function" ? agentId : computed(() => agentId);

  return agentFactory.createAgentStoreSignal(agentIdSignal, destroyRef);
}
