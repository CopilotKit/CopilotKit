import type { Signal } from "@angular/core";
import { computed, signal, type WritableSignal } from "@angular/core";
import type {
  AbstractAgent,
  Interrupt,
  ResumeEntry,
  RunAgentResult,
} from "@ag-ui/client";
import { ɵInterruptController } from "@copilotkit/core";
import type { ɵInterruptSnapshot } from "@copilotkit/core";

/** Legacy custom-event interrupt payload. */
export interface InterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}

/** Options forwarded when resuming an interrupted agent. */
export interface InterruptRunOptions {
  runId?: string;
  resume?: ResumeEntry[];
  forwardedProps?: Record<string, unknown>;
}

/** Injectable interrupt filtering and preprocessing options. */
export interface InjectInterruptOptions<TValue = unknown, TResult = never> {
  /** Agent id or signal. Defaults to the ambient chat agent. */
  agentId?: string | Signal<string | undefined>;
  /** Return false to leave this interrupt for a different controller. */
  enabled?: (event: InterruptEvent<TValue>) => boolean | PromiseLike<boolean>;
  /** Optionally prepare data for the interrupt UI. */
  handler?: (
    props: InterruptHandlerProps<TValue>,
  ) => TResult | PromiseLike<TResult>;
}

/** Actions and normalized protocol data passed to interrupt handlers. */
export interface InterruptHandlerProps<TValue = unknown> {
  event: InterruptEvent<TValue>;
  interrupt: Interrupt | null;
  interrupts: readonly Interrupt[];
  resolve: InterruptController<TValue>["resolve"];
  cancel: InterruptController<TValue>["cancel"];
}

/** Reactive data suitable for binding to an application interrupt component. */
export interface InterruptView<
  TValue = unknown,
  TResult = unknown,
> extends InterruptHandlerProps<TValue> {
  result: TResult | null;
}

export type InterruptRunner = (
  agent: AbstractAgent,
  options: InterruptRunOptions,
) => Promise<RunAgentResult>;

/** Error surfaced when an application attempts to resume an expired interrupt. */
export { ɵInterruptExpiredError as InterruptExpiredError } from "@copilotkit/core";

/**
 * Signal-based state machine for standard AG-UI and legacy interrupts. It
 * projects core's `ɵInterruptController` into Angular signals.
 *
 * Prefer {@link injectInterrupt} in application components. The public class is
 * useful for framework adapters and deterministic lifecycle tests.
 */
export class InterruptController<TValue = unknown, TResult = never> {
  readonly #controller: ɵInterruptController<TValue, TResult>;
  readonly #snapshot: WritableSignal<ɵInterruptSnapshot<TValue, TResult>>;

  readonly view = computed<InterruptView<TValue, TResult> | null>(
    () => this.#snapshot().renderProps,
  );
  readonly event = computed<InterruptEvent<TValue> | null>(
    () => this.view()?.event ?? null,
  );
  readonly interrupt = computed<Interrupt | null>(
    () => this.view()?.interrupt ?? null,
  );
  readonly interrupts = computed<readonly Interrupt[]>(
    () => this.view()?.interrupts ?? [],
  );
  readonly result = computed<TResult | null>(() => this.#snapshot().result);
  readonly error = computed<unknown | null>(() => this.#snapshot().error);
  readonly hasInterrupt = computed(() => this.view() !== null);

  /** Resolve one interrupt, resuming only after the complete set is addressed. */
  readonly resolve: (
    payload?: unknown,
    interruptId?: string,
  ) => Promise<RunAgentResult | void>;
  /** Cancel one standard interrupt; legacy interrupts are dismissed locally. */
  readonly cancel: (interruptId?: string) => Promise<RunAgentResult | void>;
  /** Alias retained for parity with other CopilotKit framework adapters. */
  readonly resolveInterrupt: InterruptController<TValue, TResult>["resolve"];
  /** Alias retained for parity with other CopilotKit framework adapters. */
  readonly cancelInterrupt: InterruptController<TValue, TResult>["cancel"];

  /** Configure the runner and optional interrupt filtering and preprocessing. */
  constructor(
    runner: InterruptRunner,
    options: InjectInterruptOptions<TValue, TResult> = {},
  ) {
    this.#controller = new ɵInterruptController<TValue, TResult>(
      { runAgent: ({ agent, ...runOptions }) => runner(agent, runOptions) },
      {
        enabled: options.enabled,
        handler: options.handler,
        name: "injectInterrupt",
      },
    );
    this.#snapshot = signal(this.#controller.getSnapshot());
    this.#controller.subscribe(() =>
      this.#snapshot.set(this.#controller.getSnapshot()),
    );
    this.resolve = this.#controller.resolve;
    this.cancel = this.#controller.cancel;
    this.resolveInterrupt = this.resolve;
    this.cancelInterrupt = this.cancel;
  }

  /** Subscribe to an agent, replacing any previous lifecycle subscription. */
  connect(agent: AbstractAgent): void {
    this.#controller.connect(agent);
  }

  /** Clear pending decisions when the host changes threads. */
  setThreadId(threadId: string): void {
    this.#controller.setThreadId(threadId);
  }

  /** Release the agent subscription and clear sensitive pending state. */
  destroy(): void {
    this.#controller.disconnect();
  }
}
