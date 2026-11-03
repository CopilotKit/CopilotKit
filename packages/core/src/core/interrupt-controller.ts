import { randomUUID } from "@ag-ui/client";
import type {
  AbstractAgent,
  Interrupt,
  Message,
  RunAgentResult,
} from "@ag-ui/client";

import { INTERRUPT_EVENT_NAME } from "../chat/interrupt-types";
import type {
  InterruptEvent,
  InterruptHandlerProps,
  InterruptRenderProps,
} from "../chat/interrupt-types";
import {
  ɵInterruptState,
  ɵclearAgentInterruptState,
  ɵgetAgentInterruptState,
} from "../interrupt-state";
import type { ɵInterruptDecision, ɵPendingInterrupt } from "../interrupt-state";
import type { CopilotKitCoreRunAgentParams } from "./run-handler";

/**
 * @internal Starts the resume run. `CopilotKitCore` satisfies this contract;
 * adapters with their own runner wrap it.
 */
export interface ɵInterruptRunner {
  runAgent(params: CopilotKitCoreRunAgentParams): Promise<RunAgentResult>;
}

/** @internal Options for {@link ɵInterruptController}. */
export interface ɵInterruptControllerOptions<
  TValue = unknown,
  TResult = unknown,
> {
  /**
   * Return `false` (or a promise of `false`) to leave the interrupt for
   * another controller. A throw or rejection also ignores the interrupt.
   */
  enabled?: (event: InterruptEvent<TValue>) => boolean | PromiseLike<boolean>;
  /**
   * Prepare data for the interrupt UI. The value (or the resolved value)
   * becomes `result`. A throw or rejection sets `result` to `null`.
   */
  handler?: (
    props: InterruptHandlerProps<TValue>,
  ) => TResult | PromiseLike<TResult>;
  /** Name of the public API, used as the prefix of log messages. */
  name?: string;
}

/**
 * @internal Immutable state of an {@link ɵInterruptController}. The object
 * identity changes only when a field changes.
 */
export interface ɵInterruptSnapshot<TValue = unknown, TResult = unknown> {
  /** The interrupt of the last run, whether or not this controller accepted it. */
  pending: ɵPendingInterrupt<TValue> | null;
  /** True when `enabled` accepted `pending`. */
  accepted: boolean;
  /** The value `handler` gave, or `null`. */
  result: TResult | null;
  /** The last failure (run error, predicate, handler, expiry), or `null`. */
  error: unknown;
  /**
   * The props for the interrupt UI. `null` when nothing is pending or this
   * controller did not accept the interrupt.
   */
  renderProps: InterruptRenderProps<TValue, TResult | null> | null;
}

/**
 * @internal Error stored in the snapshot when the user answers an interrupt
 * after its `expiresAt`. Angular exports it as `InterruptExpiredError`.
 */
export class ɵInterruptExpiredError extends Error {
  /** Describe the interrupt whose expiry prevents resolution. */
  constructor(readonly interrupt: Interrupt) {
    super(
      `Interrupt ${interrupt.id} expired at ${interrupt.expiresAt ?? "an unknown time"}.`,
    );
    this.name = "InterruptExpiredError";
  }
}

/** @internal Recognize thenables returned by interrupt predicates and handlers. */
export function ɵisPromiseLike<TValue>(
  value: TValue | PromiseLike<TValue>,
): value is PromiseLike<TValue> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

/** @internal Derive the legacy-compatible `event` for any pending interrupt. */
export function ɵtoLegacyInterruptEvent<TValue>(
  pending: ɵPendingInterrupt<TValue>,
): InterruptEvent<TValue> {
  if (pending.kind === "legacy") return pending.event;
  return {
    name: INTERRUPT_EVENT_NAME,
    value: pending.interrupts[0] as TValue,
  };
}

const EMPTY_SNAPSHOT: ɵInterruptSnapshot<never, never> = Object.freeze({
  pending: null,
  accepted: false,
  result: null,
  error: null,
  renderProps: null,
});

/**
 * @internal Framework-neutral interrupt lifecycle for one consumer (a React or
 * Vue hook, or an Angular controller). It collects legacy (`on_interrupt`)
 * and standard (`RUN_FINISHED` `outcome: "interrupt"`) interrupts from the
 * agent, runs `enabled` and `handler`, records answers in the shared
 * {@link ɵInterruptState}, appends tool results and starts the resume run.
 *
 * Adapters project {@link getSnapshot} into their own reactivity and publish
 * `renderProps` to the chat. Application authors must not depend on this API.
 */
export class ɵInterruptController<TValue = unknown, TResult = unknown> {
  readonly #runner: ɵInterruptRunner;
  readonly #options: ɵInterruptControllerOptions<TValue, TResult>;
  readonly #name: string;
  readonly #listeners = new Set<() => void>();
  #snapshot: ɵInterruptSnapshot<TValue, TResult> = EMPTY_SNAPSHOT;
  #state = new ɵInterruptState<TValue>();
  #agent?: AbstractAgent;
  #unsubscribe?: () => void;
  #threadId?: string;
  /** Bumped on every pending change so stale async work is dropped. */
  #generation = 0;
  #resumePromise?: Promise<RunAgentResult | void>;

  /** Configure the runner and the optional filter and preparation step. */
  constructor(
    runner: ɵInterruptRunner,
    options: ɵInterruptControllerOptions<TValue, TResult> = {},
  ) {
    this.#runner = runner;
    this.#options = options;
    this.#name = options.name ?? "useInterrupt";
  }

  /** Return the current state. Same object until something changes. */
  getSnapshot = (): ɵInterruptSnapshot<TValue, TResult> => this.#snapshot;

  /** Call `listener` after every snapshot change. Returns the unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Follow `agent`, replacing any earlier agent. An interrupt the agent
   * already holds (for example after a reload) becomes pending at once.
   */
  connect(agent: AbstractAgent): void {
    if (agent === this.#agent) return;
    this.#unsubscribe?.();
    this.#agent = agent;
    this.#threadId = agent.threadId;
    this.#clear();

    let legacy: InterruptEvent<TValue> | null = null;
    let standard: Interrupt[] | null = null;
    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name === INTERRUPT_EVENT_NAME) {
          legacy = { name: event.name, value: event.value as TValue };
        }
      },
      onRunFinishedEvent: (params) => {
        if (params.outcome === "interrupt") standard = params.interrupts;
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
        // Standard wins if both appear in one run.
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
    // Subscribe before reading so an interrupt finalized meanwhile is kept.
    if (agent.pendingInterrupts?.length) {
      this.#setPending({
        kind: "standard",
        interrupts: [...agent.pendingInterrupts],
      });
    }
  }

  /** Stop following the agent and clear pending state. `connect` may follow. */
  disconnect(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#agent = undefined;
    this.#clear();
  }

  /** Clear the pending interrupt when the host switches threads. */
  setThreadId(threadId: string): void {
    if (this.#threadId === undefined) {
      this.#threadId = threadId;
      return;
    }
    if (threadId === this.#threadId) return;
    this.#threadId = threadId;
    this.#clear();
  }

  /**
   * Answer one interrupt (default: the first). A standard batch resumes once
   * every interrupt has an answer; a legacy interrupt resumes at once with
   * `forwardedProps.command`. Calls during a resume return the same promise.
   */
  readonly resolve = async (
    payload?: unknown,
    interruptId?: string,
  ): Promise<RunAgentResult | void> => {
    if (this.#resumePromise) return this.#resumePromise;
    const target = this.#target();
    if (!target) return;
    const { agent, pending } = target;

    if (pending.kind === "legacy") {
      const decision = this.#state.resolve(payload, interruptId);
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

    const id = this.#targetId(pending.interrupts, interruptId, agent);
    if (!id) return;
    return this.#handleStandardDecision(
      agent,
      this.#state.resolve(payload, id, agent.messages),
    );
  };

  /**
   * Cancel one standard interrupt (default: the first). A legacy interrupt
   * has no cancel semantics, so it is dismissed without a resume.
   */
  readonly cancel = async (
    interruptId?: string,
  ): Promise<RunAgentResult | void> => {
    if (this.#resumePromise) return this.#resumePromise;
    const target = this.#target();
    if (!target) return;
    const { agent, pending } = target;

    if (pending.kind === "legacy") {
      if (this.#state.cancel(interruptId).kind !== "dismiss") return;
      console.warn(
        `[CopilotKit] ${this.#name}: cancel() is not supported for legacy on_interrupt interrupts; dismissing.`,
      );
      this.#clear();
      return;
    }

    const id = this.#targetId(pending.interrupts, interruptId, agent);
    if (!id) return;
    return this.#handleStandardDecision(
      agent,
      this.#state.cancel(id, agent.messages),
    );
  };

  /** Disconnect and drop all listeners. */
  dispose(): void {
    this.disconnect();
    this.#listeners.clear();
  }

  /** Return the accepted interrupt of the current thread, or `undefined`. */
  #target():
    | { agent: AbstractAgent; pending: ɵPendingInterrupt<TValue> }
    | undefined {
    const { pending, accepted } = this.#snapshot;
    const agent = this.#agent;
    if (!pending || !accepted || !agent) return undefined;
    if (this.#threadId !== agent.threadId) {
      // The thread changed under the interrupt: it no longer applies.
      this.setThreadId(agent.threadId);
      return undefined;
    }
    return { agent, pending };
  }

  /** Pick the interrupt an answer addresses; skip unknown or completed ones. */
  #targetId(
    interrupts: readonly Interrupt[],
    requestedId: string | undefined,
    agent: AbstractAgent,
  ): string | undefined {
    if (interrupts.length > 1 && requestedId === undefined) {
      console.warn(
        `[CopilotKit] ${this.#name}: resolve()/cancel() called without an interruptId while ${interrupts.length} interrupts are open; defaulting to the first. Pass an interruptId to address a specific interrupt.`,
      );
    }
    const id = requestedId ?? interrupts[0]?.id;
    if (!id || !interrupts.some((interrupt) => interrupt.id === id)) {
      console.warn(
        `[CopilotKit] ${this.#name}: ignored unknown interrupt id ${String(id)}.`,
      );
      return undefined;
    }
    if (this.#state.isCompletedToolCall(id, agent.messages)) {
      console.warn(
        `[CopilotKit] ${this.#name}: ignoring an answer for an already completed frontend tool call.`,
      );
      return undefined;
    }
    return id;
  }

  /** Act on a standard-batch decision: wait, expire, or append results and resume. */
  async #handleStandardDecision(
    agent: AbstractAgent,
    decision: ɵInterruptDecision,
  ): Promise<RunAgentResult | void> {
    if (decision.kind === "expired") {
      const error = new ɵInterruptExpiredError(decision.interrupt);
      console.error(
        `[CopilotKit] ${this.#name}: interrupt ${decision.interrupt.id} expired at ${decision.interrupt.expiresAt}; not resuming.`,
      );
      this.#clear(error);
      return;
    }
    if (decision.kind !== "resume") return;
    try {
      for (const toolResult of decision.toolResults) {
        agent.addMessage({
          id: randomUUID(),
          role: "tool",
          toolCallId: toolResult.toolCallId,
          content: toolResult.content,
        } as Message);
      }
    } catch (error) {
      this.#clear(error);
      throw error;
    }
    return this.#startResume(agent, { resume: decision.resume });
  }

  /** Start the resume run once and clear pending state if it fails. */
  #startResume(
    agent: AbstractAgent,
    params: Omit<CopilotKitCoreRunAgentParams, "agent">,
  ): Promise<RunAgentResult | void> {
    const pending = this.#snapshot.pending;
    let run: Promise<RunAgentResult>;
    try {
      run = this.#runner.runAgent({ agent, ...params });
    } catch (error) {
      this.#clear(error);
      return Promise.reject(error);
    }

    const tracked = run.catch((error: unknown) => {
      const stillCurrent = this.#snapshot.pending === pending;
      console.error(
        stillCurrent
          ? `[CopilotKit] ${this.#name} resolve: runAgent rejected; clearing pending + rethrowing`
          : `[CopilotKit] ${this.#name}: a stale resume failed after the interrupt was replaced`,
        error,
      );
      if (stillCurrent) this.#clear(error);
      throw error;
    });
    if (this.#snapshot.pending === pending) this.#resumePromise = tracked;
    return tracked;
  }

  /** Adopt the shared batch, then run `enabled` and `handler` for it. */
  #setPending(next: ɵPendingInterrupt<TValue>): void {
    this.#generation += 1;
    const generation = this.#generation;
    let pending: ɵPendingInterrupt<TValue>;
    try {
      if (next.kind === "standard") {
        this.#state = ɵgetAgentInterruptState(
          this.#agent!,
          next.interrupts,
        ) as ɵInterruptState<TValue>;
      } else {
        this.#state = new ɵInterruptState<TValue>();
        this.#state.setLegacy(next.event);
      }
      pending = this.#state.pending!;
    } catch (error) {
      console.error(
        `[CopilotKit] ${this.#name}: rejected an invalid interrupt batch:`,
        error,
      );
      this.#clear(error);
      return;
    }
    this.#resumePromise = undefined;
    this.#update({ pending, accepted: false, result: null, error: null });

    const event = ɵtoLegacyInterruptEvent(pending);
    let enabled: boolean | PromiseLike<boolean>;
    try {
      enabled = this.#options.enabled?.(event) ?? true;
    } catch (error) {
      this.#rejectInterrupt(error, generation);
      return;
    }
    if (ɵisPromiseLike(enabled)) {
      Promise.resolve(enabled).then(
        (accepted) => {
          if (accepted) this.#accept(pending, event, generation);
        },
        (error: unknown) => this.#rejectInterrupt(error, generation),
      );
      return;
    }
    if (enabled) this.#accept(pending, event, generation);
  }

  /** Show the interrupt and run the optional preparation handler. */
  #accept(
    pending: ɵPendingInterrupt<TValue>,
    event: InterruptEvent<TValue>,
    generation: number,
  ): void {
    if (generation !== this.#generation) return;
    this.#update({ accepted: true });
    const handler = this.#options.handler;
    if (!handler) return;
    let prepared: TResult | PromiseLike<TResult>;
    try {
      prepared = handler({
        event,
        interrupt:
          pending.kind === "standard" ? (pending.interrupts[0] ?? null) : null,
        interrupts: pending.kind === "standard" ? [...pending.interrupts] : [],
        resolve: this.resolve,
        cancel: this.cancel,
      });
    } catch (error) {
      this.#failPreparation(error, generation);
      return;
    }
    if (!ɵisPromiseLike(prepared)) {
      this.#update({ result: prepared });
      return;
    }
    Promise.resolve(prepared).then(
      (result) => {
        if (generation === this.#generation) this.#update({ result });
      },
      (error: unknown) => this.#failPreparation(error, generation),
    );
  }

  #rejectInterrupt(error: unknown, generation: number): void {
    if (generation !== this.#generation) return;
    console.error(
      `[CopilotKit] ${this.#name} enabled predicate threw; treating interrupt as disabled:`,
      error,
    );
    this.#update({ accepted: false, error });
  }

  #failPreparation(error: unknown, generation: number): void {
    if (generation !== this.#generation) return;
    console.error(
      `[CopilotKit] ${this.#name} handler failed; result will be null:`,
      error,
    );
    this.#update({ result: null, error });
  }

  /** Drop pending state and invalidate async work. Shared decisions survive. */
  #clear(error: unknown = null): void {
    this.#generation += 1;
    this.#resumePromise = undefined;
    this.#state = new ɵInterruptState<TValue>();
    this.#update({ pending: null, accepted: false, result: null, error });
  }

  /** Apply a change, rebuild `renderProps` and notify listeners. */
  #update(
    patch: Partial<Omit<ɵInterruptSnapshot<TValue, TResult>, "renderProps">>,
  ): void {
    const current = this.#snapshot;
    const next = { ...current, ...patch };
    if (
      next.pending === current.pending &&
      next.accepted === current.accepted &&
      next.result === current.result &&
      next.error === current.error
    ) {
      return;
    }
    const { pending, accepted, result } = next;
    this.#snapshot = {
      ...next,
      renderProps:
        pending && accepted
          ? {
              event: ɵtoLegacyInterruptEvent(pending),
              interrupt:
                pending.kind === "standard"
                  ? (pending.interrupts[0] ?? null)
                  : null,
              interrupts:
                pending.kind === "standard" ? [...pending.interrupts] : [],
              result,
              resolve: this.resolve,
              cancel: this.cancel,
            }
          : null,
    };
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[CopilotKit] interrupt listener error:", error);
      }
    }
  }
}
