import {
  DestroyRef,
  Injectable,
  Injector,
  Signal,
  computed,
  effect,
  inject,
  runInInjectionContext,
  signal,
} from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { CopilotKit } from "./copilotkit";
import { injectAgentStore, type AgentStore } from "./agent";

/**
 * Custom event name emitted by the agent runtime when an interrupt occurs.
 * Mirrors `INTERRUPT_EVENT_NAME` in React's `useInterrupt`.
 */
const INTERRUPT_EVENT_NAME = "on_interrupt";

/**
 * Shape of an interrupt payload as exposed to consumer code.
 *
 * `value` is whatever the agent passed alongside `on_interrupt`. Type-narrow
 * it in your `enabled`/`handler` callbacks based on your agent's contract.
 */
export interface InterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}

/**
 * Props passed to the optional `handler` function.
 */
export interface InterruptHandlerProps<TValue = unknown> {
  event: InterruptEvent<TValue>;
  resolve: (response: unknown) => void;
}

export type InterruptHandlerFn<TValue = unknown, TResult = unknown> = (
  props: InterruptHandlerProps<TValue>,
) => TResult | PromiseLike<TResult>;

export type InterruptEnabledFn<TValue = unknown> = (
  event: InterruptEvent<TValue>,
) => boolean;

/**
 * Configuration for {@link injectInterrupt}.
 */
export interface InjectInterruptInput<TValue = unknown, TResult = unknown> {
  /** Optional agent id. Defaults to the configured default agent. */
  agentId?: string | Signal<string | undefined>;
  /**
   * Optional predicate to filter which interrupts should be handled by this
   * store. Return `false` to ignore an interrupt — `event()` stays `null`.
   */
  enabled?: InterruptEnabledFn<TValue>;
  /**
   * Optional pre-render handler invoked when an interrupt is finalized. Its
   * resolved value is exposed via `result()`. Sync, async, and thenable return
   * values are all accepted; rejection / throw falls back to `null`.
   */
  handler?: InterruptHandlerFn<TValue, TResult>;
}

/**
 * Signal-based store returned by {@link injectInterrupt}.
 */
export interface InterruptStoreSignal<TValue = unknown, TResult = unknown> {
  /**
   * The currently active interrupt, or `null` when there is no pending
   * interrupt (also `null` while the run is still streaming and after the
   * `enabled` predicate rejects an interrupt).
   */
  event: Signal<InterruptEvent<TValue> | null>;
  /**
   * Result of the optional `handler` function. `null` when no handler was
   * provided, when the handler is still resolving an async value, or when
   * the handler threw / rejected.
   */
  result: Signal<TResult | null>;
  /** Convenience: `true` when `event()` is non-null (i.e. UI should render). */
  isPending: Signal<boolean>;
  /**
   * Resume the agent run with the given response. Clears the local state and
   * dispatches `core.runAgent({ agent, forwardedProps: { command: { resume,
   * interruptEvent } } })` so the runtime can continue from the interrupt.
   *
   * Safe to call when no interrupt is pending — it becomes a no-op.
   */
  resolve: (response: unknown) => void;
}

function isPromiseLike<TValue>(
  value: TValue | PromiseLike<TValue>,
): value is PromiseLike<TValue> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value as object, "then") === "function"
  );
}

@Injectable({ providedIn: "root" })
export class CopilotkitInterruptFactory {
  readonly #copilotkit = inject(CopilotKit);

  createInterruptStoreSignal<TValue, TResult>(
    input: {
      agentId: Signal<string | undefined>;
      enabled?: InterruptEnabledFn<TValue>;
      handler?: InterruptHandlerFn<TValue, TResult>;
    },
    injector: Injector,
    destroyRef: DestroyRef,
  ): InterruptStoreSignal<TValue, TResult> {
    const copilotkit = this.#copilotkit;

    // Build (and tear down) the AgentStore inside an injection context so
    // injectAgentStore can pick up DestroyRef / Injector. The reactive
    // computed inside AgentStore reads the agentId signal, so re-rendering
    // with a different agent id transparently re-targets subscriptions.
    const agentStoreSignal: Signal<AgentStore> = runInInjectionContext(
      injector,
      () =>
        injectAgentStore(computed(() => input.agentId() ?? DEFAULT_AGENT_ID)),
    );

    // Local buffer that mirrors the React hook: a custom `on_interrupt`
    // event is *staged* until the run finalizes — only then do we expose it.
    type Buffer = InterruptEvent<TValue> | null;
    let pendingBuffer: Buffer = null;

    const eventState = signal<InterruptEvent<TValue> | null>(null);
    // We reset per-event when the staged interrupt changes. Initialised to
    // null so consumers see a stable shape until the first run finalizes.
    const resultState = signal<TResult | null>(null);
    let resultRunToken = 0;

    let currentAgent: AbstractAgent | null = null;
    let currentSubscription: { unsubscribe: () => void } | null = null;

    const resolve = (response: unknown): void => {
      const interruptEvent = eventState();
      if (!interruptEvent) return;
      // Bump the token so any in-flight handler promise that settles after
      // this point is discarded — otherwise its `.then` callback would
      // repopulate `resultState` with a stale value the user just cleared.
      resultRunToken++;
      eventState.set(null);
      resultState.set(null);
      pendingBuffer = null;
      // We deliberately ignore the runAgent promise: callers that want to
      // observe completion should subscribe to AgentStore.isRunning. This
      // matches React's `useInterrupt` which fires-and-forgets.
      const agent = currentAgent;
      if (!agent) return;
      void copilotkit.core.runAgent({
        agent,
        forwardedProps: {
          command: {
            resume: response,
            interruptEvent: interruptEvent.value,
          },
        },
      });
    };

    const subscribeAgent = (agent: AbstractAgent): void => {
      currentAgent = agent;
      currentSubscription = agent.subscribe({
        onCustomEvent: ({ event }) => {
          if (event.name === INTERRUPT_EVENT_NAME) {
            pendingBuffer = {
              name: event.name,
              value: event.value as TValue,
            };
          }
        },
        onRunStartedEvent: () => {
          pendingBuffer = null;
          eventState.set(null);
          resultState.set(null);
        },
        onRunFinalized: () => {
          if (!pendingBuffer) return;
          const candidate = pendingBuffer;
          pendingBuffer = null;
          if (input.enabled && !input.enabled(candidate)) {
            // Filter rejected — discard. Do not expose; do not run handler.
            eventState.set(null);
            resultState.set(null);
            return;
          }
          eventState.set(candidate);
          runHandler(candidate);
        },
        onRunFailed: () => {
          pendingBuffer = null;
        },
      });
    };

    const runHandler = (interruptEvent: InterruptEvent<TValue>): void => {
      const handler = input.handler;
      if (!handler) {
        resultState.set(null);
        return;
      }
      const token = ++resultRunToken;
      const handlerResult = handler({
        event: interruptEvent,
        resolve,
      });
      if (isPromiseLike(handlerResult)) {
        Promise.resolve(handlerResult)
          .then((resolved) => {
            // Discard if a newer interrupt has arrived OR the user resolved
            // before the handler settled — token is bumped on each new run
            // and the eventState is cleared on resolve.
            if (token !== resultRunToken) return;
            resultState.set((resolved ?? null) as TResult | null);
          })
          .catch(() => {
            if (token !== resultRunToken) return;
            resultState.set(null);
          });
        // While the handler is in-flight, expose null per the React
        // contract. Consumers can `result() ?? fallback` if they prefer.
        resultState.set(null);
      } else {
        resultState.set((handlerResult ?? null) as TResult | null);
      }
    };

    const teardownSubscription = (): void => {
      currentSubscription?.unsubscribe();
      currentSubscription = null;
      currentAgent = null;
      pendingBuffer = null;
    };

    // Re-subscribe whenever the AgentStore signal changes (which happens when
    // the agent id signal changes or the runtime resolves a real agent).
    const agentEffect = runInInjectionContext(injector, () =>
      effect(() => {
        const agentStore = agentStoreSignal();
        const nextAgent = agentStore.agent;
        if (nextAgent === currentAgent) return;
        teardownSubscription();
        eventState.set(null);
        resultState.set(null);
        subscribeAgent(nextAgent);
      }),
    );

    destroyRef.onDestroy(() => {
      agentEffect.destroy();
      teardownSubscription();
    });

    const isPending = computed(() => eventState() !== null);

    return {
      event: eventState.asReadonly(),
      result: resultState.asReadonly(),
      isPending,
      resolve,
    };
  }
}

/**
 * Angular equivalent of React's `useInterrupt`.
 *
 * Listens for `on_interrupt` custom events on the configured agent, buffers
 * the latest payload until the run finalizes, optionally filters via
 * `enabled`, optionally pre-processes via `handler`, and surfaces a
 * signal-based store that consumers render from their own templates.
 *
 * Unlike the React variant, this does not auto-publish a rendered element
 * into `<CopilotChat>` — Angular templates render reactively from the
 * exposed signals, so consumers wire up their own UI with `@if` /
 * structural directives. Call `resolve(response)` from your UI handlers
 * to resume the agent run with the user's input.
 *
 * Must be invoked in an Angular DI / injection context.
 *
 * @example
 * ```ts
 * @Component({
 *   template: `
 *     @if (interrupt.event(); as event) {
 *       <div>
 *         <p>{{ event.value.question }}</p>
 *         <button (click)="approve(event)">Approve</button>
 *         <button (click)="reject(event)">Reject</button>
 *       </div>
 *     }
 *   `,
 * })
 * export class InterruptUi {
 *   readonly interrupt = injectInterrupt<{ question: string }>();
 *
 *   approve(event: InterruptEvent<{ question: string }>) {
 *     this.interrupt.resolve({ approved: true });
 *   }
 *
 *   reject(event: InterruptEvent<{ question: string }>) {
 *     this.interrupt.resolve({ approved: false });
 *   }
 * }
 * ```
 */
export function injectInterrupt<TValue = unknown, TResult = unknown>(
  input: InjectInterruptInput<TValue, TResult> = {},
): InterruptStoreSignal<TValue, TResult> {
  const factory = inject(CopilotkitInterruptFactory);
  const injector = inject(Injector);
  const destroyRef = inject(DestroyRef);

  const agentIdInput = input.agentId;
  const agentIdSignal: Signal<string | undefined> =
    typeof agentIdInput === "function"
      ? (agentIdInput as Signal<string | undefined>)
      : computed(() => agentIdInput);

  return factory.createInterruptStoreSignal<TValue, TResult>(
    {
      agentId: agentIdSignal,
      enabled: input.enabled,
      handler: input.handler,
    },
    injector,
    destroyRef,
  );
}
