import type { Signal } from "@angular/core";
import { DestroyRef, computed, effect, inject, signal } from "@angular/core";
import {
  buildResumeArray,
  isInterruptExpired,
  randomUUID,
} from "@ag-ui/client";
import type {
  AbstractAgent,
  Interrupt,
  Message,
  ResumeEntry,
  RunAgentResult,
} from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";

import { injectAgentStore } from "./agent";
import { COPILOT_CHAT_CONFIGURATION } from "./chat-configuration";
import { CopilotKit } from "./copilotkit";

const INTERRUPT_EVENT_NAME = "on_interrupt";

type ResumeResponse =
  | { status: "resolved"; payload?: unknown }
  | { status: "cancelled" };

type PendingInterrupt<TValue> =
  | { kind: "legacy"; event: InterruptEvent<TValue> }
  | { kind: "standard"; interrupts: Interrupt[] };

/** Legacy custom-event interrupt payload. */
export interface InterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}

/** Options forwarded when resuming an interrupted agent. */
export interface InterruptRunOptions {
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
export class InterruptExpiredError extends Error {
  constructor(readonly interrupt: Interrupt) {
    super(
      `Interrupt ${interrupt.id} expired at ${interrupt.expiresAt ?? "an unknown time"}.`,
    );
    this.name = "InterruptExpiredError";
  }
}

function toLegacyEvent<TValue>(
  pending: PendingInterrupt<TValue>,
): InterruptEvent<TValue> {
  if (pending.kind === "legacy") return pending.event;
  return {
    name: INTERRUPT_EVENT_NAME,
    value: pending.interrupts[0] as TValue,
  };
}

function toolResultContent(response: ResumeResponse): string {
  const content =
    response.status === "cancelled"
      ? { status: "cancelled" }
      : (response.payload ?? { status: "resolved" });
  return JSON.stringify(content);
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
  readonly #responses: Record<string, ResumeResponse> = {};
  readonly #runner: InterruptRunner;
  readonly #options: InjectInterruptOptions<TValue, TResult>;
  #agent?: AbstractAgent;
  #unsubscribe?: () => void;
  #threadId?: string;
  #handlerGeneration = 0;
  #resumePromise?: Promise<RunAgentResult | void>;

  readonly event = computed<InterruptEvent<TValue> | null>(() => {
    const pending = this.#pending();
    return pending && this.#accepted() ? toLegacyEvent(pending) : null;
  });
  readonly interrupt = computed<Interrupt | null>(() => {
    const pending = this.#pending();
    return pending?.kind === "standard" && this.#accepted()
      ? (pending.interrupts[0] ?? null)
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
      onRunStartedEvent: () => {
        legacy = null;
        standard = null;
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

  /** Resolve one interrupt, resuming only after the complete set is addressed. */
  readonly resolve = async (
    payload?: unknown,
    interruptId?: string,
  ): Promise<RunAgentResult | void> => {
    if (this.#resumePromise) return this.#resumePromise;
    const current = this.#pending();
    const agent = this.#agent;
    if (!current || !agent) return;

    if (current.kind === "legacy") {
      return this.#startResume(agent, {
        forwardedProps: {
          command: {
            resume: payload,
            interruptEvent: current.event.value,
          },
        },
      });
    }

    const id = this.#targetId(current.interrupts, interruptId);
    if (!id) return;
    this.#responses[id] = { status: "resolved", payload };
    return this.#submitStandardIfComplete(agent, current.interrupts);
  };

  /** Cancel one standard interrupt; legacy interrupts are dismissed locally. */
  readonly cancel = async (
    interruptId?: string,
  ): Promise<RunAgentResult | void> => {
    if (this.#resumePromise) return this.#resumePromise;
    const current = this.#pending();
    const agent = this.#agent;
    if (!current || !agent) return;

    if (current.kind === "legacy") {
      console.warn(
        "[CopilotKit] injectInterrupt: legacy on_interrupt events cannot be cancelled; dismissing.",
      );
      this.#clear();
      return;
    }

    const id = this.#targetId(current.interrupts, interruptId);
    if (!id) return;
    this.#responses[id] = { status: "cancelled" };
    return this.#submitStandardIfComplete(agent, current.interrupts);
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

  #setPending(pending: PendingInterrupt<TValue>): void {
    this.#handlerGeneration += 1;
    const generation = this.#handlerGeneration;
    this.#pending.set(pending);
    this.#accepted.set(false);
    this.#result.set(null);
    this.#error.set(null);
    for (const id of Object.keys(this.#responses)) delete this.#responses[id];

    const event = toLegacyEvent(pending);
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
        interrupt:
          pending.kind === "standard" ? (pending.interrupts[0] ?? null) : null,
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
      this.#result.set(prepared);
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
    if (interrupts.length > 1 && requestedId === undefined) {
      console.warn(
        `[CopilotKit] injectInterrupt: resolve()/cancel() called without an interruptId while ${interrupts.length} interrupts are open; defaulting to the first.`,
      );
    }
    const id = requestedId ?? interrupts[0]?.id;
    if (!id || !interrupts.some((interrupt) => interrupt.id === id)) {
      console.warn(
        `[CopilotKit] injectInterrupt: ignored unknown interrupt id ${String(id)}.`,
      );
      return undefined;
    }
    return id;
  }

  async #submitStandardIfComplete(
    agent: AbstractAgent,
    interrupts: Interrupt[],
  ): Promise<RunAgentResult | void> {
    if (!interrupts.every(({ id }) => this.#responses[id])) return;

    const expired = interrupts.find((interrupt) =>
      isInterruptExpired(interrupt),
    );
    if (expired) {
      const error = new InterruptExpiredError(expired);
      console.error(`[CopilotKit] injectInterrupt: ${error.message}`);
      this.#clear(error);
      return;
    }

    try {
      const resume = buildResumeArray(interrupts, this.#responses);
      const toolMessages = interrupts.flatMap((interrupt): Message[] => {
        if (!interrupt.toolCallId) return [];
        return [
          {
            id: randomUUID(),
            role: "tool",
            toolCallId: interrupt.toolCallId,
            content: toolResultContent(this.#responses[interrupt.id]!),
          } as Message,
        ];
      });
      for (const message of toolMessages) agent.addMessage(message);
      return this.#startResume(agent, { resume });
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
      console.error(
        "[CopilotKit] injectInterrupt resume failed; pending state was cleared and the run will not be retried:",
        error,
      );
      this.#clear(error);
      throw error;
    });
    if (this.#pending() === pending) this.#resumePromise = tracked;
    return tracked;
  }

  #clear(error: unknown | null = null): void {
    this.#handlerGeneration += 1;
    this.#pending.set(null);
    this.#accepted.set(false);
    this.#result.set(null);
    this.#error.set(error);
    this.#resumePromise = undefined;
    for (const id of Object.keys(this.#responses)) delete this.#responses[id];
  }
}

/**
 * Create an interrupt controller in the current Angular injection context.
 *
 * The controller follows the ambient chat agent and thread unless an explicit
 * agent is supplied. Bind its signals in a template and call `resolve` or
 * `cancel` from user-driven event handlers.
 */
export function injectInterrupt<TValue = unknown, TResult = never>(
  options: InjectInterruptOptions<TValue, TResult> = {},
): InterruptController<TValue, TResult> {
  const copilotKit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);
  const chatConfiguration = inject(COPILOT_CHAT_CONFIGURATION, {
    optional: true,
  });
  const configuredAgentId = options.agentId;
  const agentId =
    typeof configuredAgentId === "function"
      ? configuredAgentId
      : computed(
          () =>
            configuredAgentId ??
            chatConfiguration?.agentId() ??
            DEFAULT_AGENT_ID,
        );
  const store = injectAgentStore(agentId);
  const controller = new InterruptController<TValue, TResult>(
    (agent, runOptions) => copilotKit.core.runAgent({ agent, ...runOptions }),
    options,
  );
  const connection = effect(() => {
    const agent = store().agent;
    controller.connect(agent);
    controller.setThreadId(chatConfiguration?.threadId() ?? agent.threadId);
  });

  destroyRef.onDestroy(() => {
    connection.destroy();
    controller.destroy();
  });
  return controller;
}
