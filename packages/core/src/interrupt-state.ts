import { buildResumeArray, isInterruptExpired } from "@ag-ui/client";
import type { Interrupt, ResumeEntry } from "@ag-ui/client";

type ResumeResponse =
  | { status: "resolved"; payload?: unknown }
  | { status: "cancelled" };

/** @internal Application authors must not depend on this contract. */
export interface ɵInterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}

/** @internal Application authors must not depend on this contract. */
export type ɵPendingInterrupt<TValue = unknown> =
  | { kind: "legacy"; event: ɵInterruptEvent<TValue> }
  | { kind: "standard"; interrupts: readonly Interrupt[] };

/** @internal Application authors must not depend on this contract. */
export interface ɵInterruptToolResult {
  toolCallId: string;
  content: string;
}

/** @internal Application authors must not depend on this contract. */
export type ɵInterruptDecision =
  | { kind: "ignored" }
  | { kind: "waiting" }
  | { kind: "dismiss" }
  | {
      kind: "expired";
      interrupt: Interrupt;
    }
  | {
      kind: "legacy-resume";
      payload: unknown;
      interruptValue: unknown;
    }
  | {
      kind: "resume";
      resume: ResumeEntry[];
      toolResults: ɵInterruptToolResult[];
    };

function toolResultContent(response: ResumeResponse): string {
  if (response.status === "cancelled") {
    return JSON.stringify({ status: "cancelled" });
  }
  return JSON.stringify(response.payload ?? { status: "resolved" });
}

/**
 * @internal A legacy interrupt a thread is still waiting on, plus the run that
 * raised it. Application authors must not depend on this contract.
 */
export interface ɵLegacyInterruptRecord<TValue = unknown> {
  event: ɵInterruptEvent<TValue>;
  runId?: string;
}

/**
 * Legacy `on_interrupt` interrupts a thread is still waiting on, keyed by the
 * agent that received them.
 *
 * `AbstractAgent.pendingInterrupts` records standard AG-UI interrupts, so a
 * framework adapter can recover a standard gate after a remount or a
 * reconnect. Legacy custom-event interrupts have no such record upstream,
 * which left the path every CLI starter takes with no way to recover a gate
 * whose event was already delivered. This map is that record.
 */
const legacyInterrupts = new WeakMap<object, ɵLegacyInterruptRecord>();

/**
 * @internal Record the legacy interrupt an agent is waiting on. Application
 * authors must not depend on this API.
 */
export function ɵrecordLegacyInterrupt<TValue>(
  agent: object,
  record: ɵLegacyInterruptRecord<TValue>,
): void {
  legacyInterrupts.set(agent, record as ɵLegacyInterruptRecord);
}

/**
 * @internal Read the legacy interrupt an agent is waiting on, if any.
 * Application authors must not depend on this API.
 */
export function ɵreadLegacyInterrupt<TValue = unknown>(
  agent: object,
): ɵLegacyInterruptRecord<TValue> | null {
  return (
    (legacyInterrupts.get(agent) as
      | ɵLegacyInterruptRecord<TValue>
      | undefined) ?? null
  );
}

/**
 * @internal Forget the legacy interrupt an agent was waiting on. Call this
 * when a new run starts, and when the interrupt is addressed or dismissed.
 * Application authors must not depend on this API.
 */
export function ɵclearLegacyInterrupt(agent: object): void {
  legacyInterrupts.delete(agent);
}

/**
 * @internal Framework-neutral interrupt response state shared by framework
 * adapters. Application authors must not depend on this API.
 */
export class ɵInterruptState<TValue = unknown> {
  readonly #responses: Record<string, ResumeResponse> = {};
  #pending: ɵPendingInterrupt<TValue> | null = null;
  #sealed = false;

  /** Return the active normalized interrupt without exposing mutable state. */
  get pending(): ɵPendingInterrupt<TValue> | null {
    const pending = this.#pending;
    if (pending?.kind === "standard") {
      return { kind: "standard", interrupts: [...pending.interrupts] };
    }
    return pending;
  }

  /** Replace the current interrupt with a legacy custom-event interrupt. */
  setLegacy(event: ɵInterruptEvent<TValue>): void {
    this.#replace({ kind: "legacy", event });
  }

  /** Replace the current interrupt with an AG-UI standard interrupt set. */
  setStandard(interrupts: readonly Interrupt[]): void {
    this.#replace({ kind: "standard", interrupts: [...interrupts] });
  }

  /** Clear all pending interrupt data and accumulated responses. */
  clear(): void {
    this.#pending = null;
    this.#sealed = false;
    for (const id of Object.keys(this.#responses)) delete this.#responses[id];
  }

  /** Record a resolved response and return the next framework action. */
  resolve(payload?: unknown, interruptId?: string): ɵInterruptDecision {
    const pending = this.#pending;
    if (!pending || this.#sealed) return { kind: "ignored" };
    if (pending.kind === "legacy") {
      this.#sealed = true;
      return {
        kind: "legacy-resume",
        payload,
        interruptValue: pending.event.value,
      };
    }
    return this.#respond(pending.interrupts, interruptId, {
      status: "resolved",
      payload,
    });
  }

  /** Record a cancelled response and return the next framework action. */
  cancel(interruptId?: string): ɵInterruptDecision {
    const pending = this.#pending;
    if (!pending || this.#sealed) return { kind: "ignored" };
    if (pending.kind === "legacy") {
      this.#sealed = true;
      return { kind: "dismiss" };
    }
    return this.#respond(pending.interrupts, interruptId, {
      status: "cancelled",
    });
  }

  #replace(pending: ɵPendingInterrupt<TValue>): void {
    this.clear();
    this.#pending = pending;
  }

  #respond(
    interrupts: readonly Interrupt[],
    interruptId: string | undefined,
    response: ResumeResponse,
  ): ɵInterruptDecision {
    const id = interruptId ?? interrupts[0]?.id;
    if (!id || !interrupts.some((interrupt) => interrupt.id === id)) {
      return { kind: "ignored" };
    }
    this.#responses[id] = response;
    if (!interrupts.every((interrupt) => this.#responses[interrupt.id])) {
      return { kind: "waiting" };
    }

    const expired = interrupts.find((interrupt) =>
      isInterruptExpired(interrupt),
    );
    if (expired) {
      this.#sealed = true;
      return { kind: "expired", interrupt: expired };
    }

    const mutableInterrupts = [...interrupts];
    const resume = buildResumeArray(mutableInterrupts, this.#responses);
    const toolResults = mutableInterrupts.flatMap((interrupt) => {
      if (!interrupt.toolCallId || interrupt.reason !== "tool_call") return [];
      return [
        {
          toolCallId: interrupt.toolCallId,
          content: toolResultContent(this.#responses[interrupt.id]!),
        },
      ];
    });
    this.#sealed = true;
    return { kind: "resume", resume, toolResults };
  }
}
