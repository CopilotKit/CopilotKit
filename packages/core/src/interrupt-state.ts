import { buildResumeArray, isInterruptExpired } from "@ag-ui/client";
import type { Interrupt, ResumeEntry, Message } from "@ag-ui/client";

import { isForwardedToClientPlaceholder } from "./core/tool-result-content";

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
  resolve(
    payload?: unknown,
    interruptId?: string,
    messages: readonly Message[] = [],
  ): ɵInterruptDecision {
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
    return this.#respond(
      pending.interrupts,
      interruptId,
      {
        status: "resolved",
        payload,
      },
      messages,
    );
  }

  /** Record a cancelled response and return the next framework action. */
  cancel(
    interruptId?: string,
    messages: readonly Message[] = [],
  ): ɵInterruptDecision {
    const pending = this.#pending;
    if (!pending || this.#sealed) return { kind: "ignored" };
    if (pending.kind === "legacy") {
      this.#sealed = true;
      return { kind: "dismiss" };
    }
    return this.#respond(
      pending.interrupts,
      interruptId,
      {
        status: "cancelled",
      },
      messages,
    );
  }

  /** Resume only when saved frontend results answer every pending interrupt. */
  resumeWithToolResults(messages: readonly Message[]): ɵInterruptDecision {
    const pending = this.#pending;
    if (pending?.kind !== "standard" || this.#sealed)
      return { kind: "ignored" };
    return this.#decide(pending.interrupts, { ...this.#responses }, messages);
  }

  #replace(pending: ɵPendingInterrupt<TValue>): void {
    this.clear();
    this.#pending = pending;
  }

  #respond(
    interrupts: readonly Interrupt[],
    interruptId: string | undefined,
    response: ResumeResponse,
    messages: readonly Message[],
  ): ɵInterruptDecision {
    const id = interruptId ?? interrupts[0]?.id;
    if (!id || !interrupts.some((interrupt) => interrupt.id === id)) {
      return { kind: "ignored" };
    }
    return this.#decide(
      interrupts,
      { ...this.#responses, [id]: response },
      messages,
    );
  }

  #decide(
    interrupts: readonly Interrupt[],
    responses: Record<string, ResumeResponse>,
    messages: readonly Message[],
  ): ɵInterruptDecision {
    const completed = new Set<string>();
    for (const interrupt of interrupts) {
      if (interrupt.reason !== "tool_call" || !interrupt.toolCallId) continue;
      const results = messages.filter(
        (message) =>
          message.role === "tool" &&
          message.toolCallId === interrupt.toolCallId &&
          !isForwardedToClientPlaceholder(message.content),
      );
      if (results.length > 1)
        throw new Error(`Duplicate tool results for ${interrupt.toolCallId}`);
      const result = results[0];
      if (!result) continue;
      const response = responses[interrupt.id];
      if (
        response &&
        (response.status !== "resolved" ||
          (response.payload !== result.content &&
            toolResultContent(response) !== result.content))
      ) {
        throw new Error(
          `Interrupt response conflicts with existing tool result for ${interrupt.toolCallId}`,
        );
      }
      // Preserve actual result bytes, including the empty string. Never create
      // another tool message for a call already answered by a frontend handler.
      responses[interrupt.id] = { status: "resolved", payload: result.content };
      completed.add(interrupt.id);
    }
    Object.assign(this.#responses, responses);
    if (!interrupts.every((interrupt) => responses[interrupt.id])) {
      return { kind: "waiting" };
    }

    const expired = interrupts.find(
      (interrupt) =>
        responses[interrupt.id]?.status !== "cancelled" &&
        isInterruptExpired(interrupt),
    );
    if (expired) {
      this.#sealed = true;
      return { kind: "expired", interrupt: expired };
    }

    const mutableInterrupts = [...interrupts];
    const resume = buildResumeArray(mutableInterrupts, responses);
    const toolResults = mutableInterrupts.flatMap((interrupt) => {
      if (
        !interrupt.toolCallId ||
        interrupt.reason !== "tool_call" ||
        completed.has(interrupt.id)
      )
        return [];
      return [
        {
          toolCallId: interrupt.toolCallId,
          content: toolResultContent(responses[interrupt.id]!),
        },
      ];
    });
    this.#sealed = true;
    return { kind: "resume", resume, toolResults };
  }
}
