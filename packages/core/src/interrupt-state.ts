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
      if (!interrupt.toolCallId) return [];
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
