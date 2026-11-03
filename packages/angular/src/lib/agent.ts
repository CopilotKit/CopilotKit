import type { Signal, WritableSignal } from "@angular/core";
import {
  DestroyRef,
  Injectable,
  inject,
  signal,
  computed,
  untracked,
} from "@angular/core";
import { CopilotKit } from "./copilotkit";
import { InterruptController, type InterruptRunner } from "./interrupt";
import type { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import type { CopilotKitCore } from "@copilotkit/core";
import {
  ɵgetAgentResolver,
  ɵresolveAgentId,
  ɵsnapshotAgentState,
} from "@copilotkit/core";

/** Function signature for subscribing to an agent — derived from
 *  CopilotKitCore so the types stay in sync automatically. Injected
 *  by the factory so that AgentStore stays decoupled from the concrete class. */
type SubscribeToAgentFn = CopilotKitCore["subscribeToAgentWithOptions"];
const missingInterruptRunner: InterruptRunner = async () => {
  throw new Error(
    "AgentStore.interruptController requires a store created by injectAgentStore().",
  );
};

export class AgentStore {
  readonly #subscription?: {
    unsubscribe: () => void;
  };
  readonly #isRunning: WritableSignal<boolean>;
  readonly #messages: WritableSignal<Message[]>;
  readonly #state: WritableSignal<unknown>;
  #unregisterDestroy?: () => void;
  #tornDown = false;

  readonly agent: AbstractAgent;
  readonly isRunning: Signal<boolean>;
  readonly messages: Signal<Message[]>;
  readonly state: Signal<unknown>;
  /** Unfiltered interrupt controller bound to this store's agent. */
  readonly interruptController: InterruptController;

  constructor(
    abstractAgent: AbstractAgent,
    destroyRef: DestroyRef,
    subscribeToAgent: SubscribeToAgentFn,
    interruptRunner: InterruptRunner = missingInterruptRunner,
  ) {
    this.agent = abstractAgent;
    this.interruptController = new InterruptController(interruptRunner);
    // A connected agent can already carry restored thread data before this
    // store subscribes. Seed the signals synchronously so the first render is
    // complete instead of waiting for a future mutation that may never occur.
    this.#isRunning = signal(abstractAgent.isRunning);
    this.isRunning = this.#isRunning.asReadonly();
    this.#messages = signal([...abstractAgent.messages]);
    this.#state = signal(ɵsnapshotAgentState(abstractAgent.state));
    this.messages = this.#messages.asReadonly();
    this.state = this.#state.asReadonly();

    this.#subscription = subscribeToAgent(abstractAgent, {
      onMessagesChanged: () => {
        this.#isRunning.set(abstractAgent.isRunning);
        this.#messages.set([...abstractAgent.messages]);
      },
      onStateChanged: () => {
        this.#isRunning.set(abstractAgent.isRunning);
        this.#state.set(ɵsnapshotAgentState(abstractAgent.state));
      },
      onRunInitialized: () => {
        this.#isRunning.set(true);
      },
      onRunStartedEvent: () => {
        this.#isRunning.set(abstractAgent.isRunning);
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
        // A replayed error does not end the connection restoring history.
        this.#isRunning.set(abstractAgent.isRunning);
      },
    });
    // Preserve the store projection as the agent's first subscriber so its
    // synchronous message/state updates keep their existing timing.
    untracked(() => this.interruptController.connect(abstractAgent));

    this.#unregisterDestroy = destroyRef.onDestroy(() => {
      this.teardown();
    });
  }

  teardown(): void {
    if (this.#tornDown) return;
    this.#tornDown = true;
    this.#unregisterDestroy?.();
    this.#unregisterDestroy = undefined;
    if (this.#subscription) {
      this.#subscription.unsubscribe();
    }
    // Agent swaps can tear down a store while the factory computed is running.
    untracked(() => this.interruptController.destroy());
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
    let lastAgent: AbstractAgent | undefined;
    const core = this.#copilotkit.core;
    const resolver = ɵgetAgentResolver(core);
    const subscribeToAgent: SubscribeToAgentFn =
      core.subscribeToAgentWithOptions.bind(core);
    const interruptRunner: InterruptRunner = (agent, runOptions) =>
      core.runAgent({ agent, ...runOptions });

    return computed(() => {
      this.#copilotkit.agents();
      this.#copilotkit.runtimeConnectionStatus();
      this.#copilotkit.runtimeUrl();
      this.#copilotkit.runtimeTransport();
      // Keyed on the generation, not header VALUES: a builder's returned
      // token can change on every resolution without a new source ever being
      // set, and this must not re-run the resolution on that (#1937).
      this.#copilotkit.ɵheadersGeneration();
      this.#copilotkit.credentials();
      const resolvedAgentId = ɵresolveAgentId({
        agentId: agentId() || undefined,
      });

      // Runtime discovery invalidates this computed. The hand-off can notify
      // the provisional store synchronously, and its subscriber must update
      // signals outside the computed's read-only reactive context.
      const { agent } = untracked(() =>
        resolver.resolve({
          agentId: resolvedAgentId,
          caller: "injectAgentStore",
        }),
      );

      if (lastAgentStore && lastAgent === agent) {
        return lastAgentStore;
      }

      lastAgentStore?.teardown();
      lastAgent = agent;
      lastAgentStore = new AgentStore(
        agent,
        destroyRef,
        subscribeToAgent,
        interruptRunner,
      );
      untracked(() => resolver.retainHandoffOrder(agent));
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
