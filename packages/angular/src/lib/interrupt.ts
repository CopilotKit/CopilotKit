import type { Signal } from "@angular/core";
import { computed, signal } from "@angular/core";
import { randomUUID } from "@ag-ui/client";
import type {
  AbstractAgent,
  Interrupt,
  Message,
  ResumeEntry,
  RunAgentResult,
} from "@ag-ui/client";
import {
  ɵInterruptState,
  ɵgetAgentInterruptState,
  ɵclearAgentInterruptState,
} from "@copilotkit/core";
import type { ɵInterruptDecision, ɵPendingInterrupt } from "@copilotkit/core";

const INTERRUPT_EVENT_NAME = "on_interrupt";

type PendingInterrupt<TValue> = ɵPendingInterrupt<TValue>;

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
  /** First unanswered standard interrupt, or null for legacy events. */
  interrupt: Interrupt | null;
  /** Full standard interrupt batch, including answered entries. */
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
export class InterruptExpiredError extends Error {
  /** Describe the interrupt whose expiry prevents resolution. */
  constructor(readonly interrupt: Interrupt) {
    super(
      `Interrupt ${interrupt.id} expired at ${interrupt.expiresAt ?? "an unknown time"}.`,
    );
    this.name = "InterruptExpiredError";
  }
}

function toLegacyEvent<TValue>(
  pending: PendingInterrupt<TValue>,
  interrupt: Interrupt | null,
): InterruptEvent<TValue> {
  if (pending.kind === "legacy") return pending.event;
  return {
    name: INTERRUPT_EVENT_NAME,
    value: interrupt as TValue,
  };
}

function isPromiseLike<TValue>(
  value: TValue | PromiseLike<TValue>,
): value is PromiseLike<TValue> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

/**
 * Signal-based state machine for standard AG-UI and legacy interrupts.
 *
 * Prefer {@link injectInterrupt} in application components. The public class is
 * useful for framework adapters and deterministic lifecycle tests.
 */
export class InterruptController<TValue = unknown, TResult = never> {
  readonly #pending = signal<PendingInterrupt<TValue> | null>(null);
  readonly #accepted = signal(false);
  readonly #result = signal<TResult | null>(null);
  readonly #error = signal<unknown | null>(null);
  #interruptState = new ɵInterruptState<TValue>();
  readonly #runner: InterruptRunner;
  readonly #options: InjectInterruptOptions<TValue, TResult>;
  #agent?: AbstractAgent;
  #unsubscribe?: () => void;
  #unsubscribeState?: () => void;
  readonly #primary = signal<Interrupt | null>(null);
  #threadId?: string;
  #handlerGeneration = 0;
  #resumePromise?: Promise<RunAgentResult | void>;

  readonly event = computed<InterruptEvent<TValue> | null>(() => {
    const pending = this.#pending();
    return pending && this.#accepted()
      ? toLegacyEvent(pending, this.#primary())
      : null;
  });
  readonly interrupt = computed<Interrupt | null>(() => {
    const pending = this.#pending();
    return pending?.kind === "standard" && this.#accepted()
      ? this.#primary()
      : null;
  });
  readonly interrupts = computed<readonly Interrupt[]>(() => {
    const pending = this.#pending();
    return pending?.kind === "standard" && this.#accepted()
      ? pending.interrupts
      : [];
  });
  readonly result = this.#result.asReadonly();
  readonly error = this.#error.asReadonly();
  readonly hasInterrupt = computed(
    () => this.#pending() !== null && this.#accepted(),
  );
  readonly view = computed<InterruptView<TValue, TResult> | null>(() => {
    const event = this.event();
    if (!event) return null;
    return {
      event,
      interrupt: this.interrupt(),
      interrupts: this.interrupts(),
      result: this.result(),
      resolve: this.resolve,
      cancel: this.cancel,
    };
  });

  /** Configure the runner and optional interrupt filtering and preprocessing. */
  constructor(
    runner: InterruptRunner,
    options: InjectInterruptOptions<TValue, TResult> = {},
  ) {
    this.#runner = runner;
    this.#options = options;
  }

  /** Subscribe to an agent, replacing any previous lifecycle subscription. */
  connect(agent: AbstractAgent): void {
    if (agent === this.#agent) return;
    this.#unsubscribe?.();
    this.#agent = agent;
    this.#threadId = agent.threadId;
    this.#clear();

    let legacy: InterruptEvent<TValue> | null = null;
    let standard: Interrupt[] | null = null;
    const subscription = agent.subscribe({
      onMessagesChanged: () => this.#refreshTarget(),
      onCustomEvent: ({ event }) => {
        if (event.name === INTERRUPT_EVENT_NAME) {
          legacy = {
            name: event.name,
            value: event.value as TValue,
          };
        }
      },
      onRunFinishedEvent: (params) => {
        if (params.outcome === "interrupt") {
          standard = params.interrupts;
        }
      },
      onRunStartedEvent: (params) => {
        // A reconnect replays RUN_STARTED without answering pending interrupts.
        // Genuine SDK runs either have no pending batch or carry resume entries.
        if (
          !agent.pendingInterrupts?.length ||
          params?.input?.resume !== undefined
        ) {
          ɵclearAgentInterruptState(agent);
        }
        legacy = null;
        standard = null;
        this.#threadId = agent.threadId;
        this.#clear();
      },
      onRunFinalized: () => {
        if (standard && standard.length > 0) {
          this.#setPending({ kind: "standard", interrupts: standard });
        } else if (legacy) {
          this.#setPending({ kind: "legacy", event: legacy });
        }
        legacy = null;
        standard = null;
      },
      onRunFailed: ({ error }) => {
        legacy = null;
        standard = null;
        this.#clear(error);
      },
      onRunErrorEvent: ({ event }) => {
        legacy = null;
        standard = null;
        this.#clear(new Error(event.message));
      },
    });
    this.#unsubscribe = () => subscription.unsubscribe();
    if (agent.pendingInterrupts.length > 0) {
      this.#setPending({
        kind: "standard",
        interrupts: [...agent.pendingInterrupts],
      });
    }
  }

  /** Clear pending decisions when the host changes threads. */
  setThreadId(threadId: string): void {
    if (this.#threadId === undefined) {
      this.#threadId = threadId;
      return;
    }
    if (threadId === this.#threadId) return;
    this.#threadId = threadId;
    this.#clear();
  }

  /** Resolve the requested or first unanswered interrupt; resume when all are answered. */
  readonly resolve = async (
    payload?: unknown,
    interruptId?: string,
  ): Promise<RunAgentResult | void> => {
    if (this.#resumePromise) return this.#resumePromise;
    if (!this.#accepted()) return;
    const current = this.#pending();
    const agent = this.#agent;
    if (!current || !agent) return;
    if (!this.#isCurrentThread(agent)) return;

    if (current.kind === "legacy") {
      const decision = this.#interruptState.resolve(payload, interruptId);
      if (decision.kind !== "legacy-resume") return;
      return this.#startResume(agent, {
        forwardedProps: {
          command: {
            resume: decision.payload,
            interruptEvent: decision.interruptValue,
          },
        },
      });
    }

    const id = this.#targetId(current.interrupts, interruptId);
    if (!id) return;
    if (this.#interruptState.isCompletedToolCall(id, agent.messages)) {
      console.warn(
        "[CopilotKit] injectInterrupt: ignoring an answer for an already completed frontend tool call.",
      );
      return;
    }
    return this.#handleStandardDecision(
      agent,
      this.#interruptState.resolve(payload, id, agent.messages),
    );
  };

  /** Cancel the requested or first unanswered interrupt; dismiss legacy events locally. */
  readonly cancel = async (
    interruptId?: string,
  ): Promise<RunAgentResult | void> => {
    if (this.#resumePromise) return this.#resumePromise;
    if (!this.#accepted()) return;
    const current = this.#pending();
    const agent = this.#agent;
    if (!current || !agent) return;
    if (!this.#isCurrentThread(agent)) return;

    if (current.kind === "legacy") {
      const decision = this.#interruptState.cancel(interruptId);
      if (decision.kind !== "dismiss") return;
      console.warn(
        "[CopilotKit] injectInterrupt: legacy on_interrupt events cannot be cancelled; dismissing.",
      );
      this.#clear();
      return;
    }

    const id = this.#targetId(current.interrupts, interruptId);
    if (!id) return;
    if (this.#interruptState.isCompletedToolCall(id, agent.messages)) {
      console.warn(
        "[CopilotKit] injectInterrupt: ignoring an answer for an already completed frontend tool call.",
      );
      return;
    }
    return this.#handleStandardDecision(
      agent,
      this.#interruptState.cancel(id, agent.messages),
    );
  };

  /** Alias retained for parity with other CopilotKit framework adapters. */
  readonly resolveInterrupt = this.resolve;
  /** Alias retained for parity with other CopilotKit framework adapters. */
  readonly cancelInterrupt = this.cancel;

  /** Release the agent subscription and clear sensitive pending state. */
  destroy(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#agent = undefined;
    this.#clear();
  }

  /** Adopt the shared batch and prepare the interrupt view for this controller. */
  #setPending(pending: PendingInterrupt<TValue>): void {
    this.#unsubscribeState?.();
    this.#handlerGeneration += 1;
    const generation = this.#handlerGeneration;
    this.#pending.set(pending);
    this.#accepted.set(false);
    this.#result.set(null);
    this.#error.set(null);
    if (pending.kind === "standard") {
      this.#interruptState = ɵgetAgentInterruptState(
        this.#agent!,
        pending.interrupts,
      ) as ɵInterruptState<TValue>;
    } else {
      this.#interruptState = new ɵInterruptState<TValue>();
      this.#interruptState.setLegacy(pending.event);
    }

    this.#primary.set(
      this.#interruptState.nextInterrupt(this.#agent?.messages),
    );
    this.#unsubscribeState = this.#interruptState.subscribe(() =>
      this.#refreshTarget(),
    );
    if (pending.kind === "standard" && !this.#primary()) return;
    const event = toLegacyEvent(pending, this.#primary());
    let enabled: boolean | PromiseLike<boolean> = true;
    try {
      enabled = this.#options.enabled?.(event) ?? true;
    } catch (error) {
      this.#handlePredicateFailure(error, generation);
      return;
    }

    if (isPromiseLike(enabled)) {
      Promise.resolve(enabled).then(
        (accepted) => {
          if (generation !== this.#handlerGeneration || !accepted) return;
          this.#activatePending(pending, event, generation);
        },
        (error: unknown) => this.#handlePredicateFailure(error, generation),
      );
      return;
    }
    if (!enabled) return;
    this.#activatePending(pending, event, generation);
  }

  #activatePending(
    pending: PendingInterrupt<TValue>,
    event: InterruptEvent<TValue>,
    generation: number,
  ): void {
    if (generation !== this.#handlerGeneration) return;
    this.#accepted.set(true);
    const handler = this.#options.handler;
    if (!handler) return;
    let prepared: TResult | PromiseLike<TResult>;
    try {
      prepared = handler({
        event,
        interrupt: pending.kind === "standard" ? this.#primary() : null,
        interrupts: pending.kind === "standard" ? pending.interrupts : [],
        resolve: this.resolve,
        cancel: this.cancel,
      });
    } catch (error) {
      this.#handlePreparationFailure(error, generation);
      return;
    }

    if (isPromiseLike(prepared)) {
      Promise.resolve(prepared).then(
        (result) => {
          if (generation === this.#handlerGeneration) this.#result.set(result);
        },
        (error: unknown) => this.#handlePreparationFailure(error, generation),
      );
    } else {
      if (generation === this.#handlerGeneration) this.#result.set(prepared);
    }
  }

  #handlePredicateFailure(error: unknown, generation: number): void {
    if (generation !== this.#handlerGeneration) return;
    console.error(
      "[CopilotKit] injectInterrupt enabled predicate failed; ignoring interrupt:",
      error,
    );
    this.#accepted.set(false);
    this.#error.set(error);
  }

  #handlePreparationFailure(error: unknown, generation: number): void {
    if (generation !== this.#handlerGeneration) return;
    console.error("[CopilotKit] injectInterrupt handler failed:", error);
    this.#result.set(null);
    this.#error.set(error);
  }

  #targetId(
    interrupts: readonly Interrupt[],
    requestedId: string | undefined,
  ): string | undefined {
    const id =
      requestedId ??
      this.#interruptState.nextInterrupt(this.#agent?.messages)?.id;
    if (requestedId === undefined && !id) return undefined;
    if (!id || !interrupts.some((interrupt) => interrupt.id === id)) {
      console.warn(
        `[CopilotKit] injectInterrupt: ignored unknown interrupt id ${String(id)}.`,
      );
      return undefined;
    }
    return id;
  }

  /** Reprepare only when the actionable prompt changes. */
  #refreshTarget(): void {
    const pending = this.#pending();
    if (pending?.kind !== "standard") return;
    const next = this.#interruptState.nextInterrupt(this.#agent?.messages);
    if (next !== this.#primary()) this.#setPending(pending);
  }

  async #handleStandardDecision(
    agent: AbstractAgent,
    decision: ɵInterruptDecision,
  ): Promise<RunAgentResult | void> {
    if (decision.kind === "waiting" || decision.kind === "ignored") return;
    if (decision.kind === "expired") {
      const error = new InterruptExpiredError(decision.interrupt);
      console.error(`[CopilotKit] injectInterrupt: ${error.message}`);
      this.#clear(error);
      return;
    }
    if (decision.kind !== "resume") return;

    try {
      const toolMessages = decision.toolResults.map(
        (toolResult): Message =>
          ({
            id: randomUUID(),
            role: "tool",
            toolCallId: toolResult.toolCallId,
            content: toolResult.content,
          }) as Message,
      );
      for (const message of toolMessages) agent.addMessage(message);
      return this.#startResume(agent, {
        resume: decision.resume,
      });
    } catch (error) {
      this.#clear(error);
      throw error;
    }
  }

  #startResume(
    agent: AbstractAgent,
    options: InterruptRunOptions,
  ): Promise<RunAgentResult | void> {
    const pending = this.#pending();
    let run: Promise<RunAgentResult>;
    try {
      run = this.#runner(agent, options);
    } catch (error) {
      this.#clear(error);
      return Promise.reject(error);
    }

    const tracked = run.catch((error: unknown) => {
      const stillCurrent = this.#pending() === pending;
      console.error(
        stillCurrent
          ? "[CopilotKit] injectInterrupt resume failed; pending state was cleared and the run will not be retried:"
          : "[CopilotKit] a stale injectInterrupt resume failed after the controller moved on:",
        error,
      );
      if (stillCurrent) this.#clear(error);
      throw error;
    });
    if (this.#pending() === pending) this.#resumePromise = tracked;
    return tracked;
  }

  #isCurrentThread(agent: AbstractAgent): boolean {
    if (this.#threadId === agent.threadId) return true;
    this.setThreadId(agent.threadId);
    return false;
  }

  /** Invalidate pending preparation and clear this controller without erasing shared decisions. */
  #clear(error: unknown | null = null): void {
    this.#unsubscribeState?.();
    this.#unsubscribeState = undefined;
    this.#primary.set(null);
    this.#handlerGeneration += 1;
    this.#pending.set(null);
    this.#accepted.set(false);
    this.#result.set(null);
    this.#error.set(error);
    this.#resumePromise = undefined;
    this.#interruptState = new ɵInterruptState<TValue>();
  }
}
