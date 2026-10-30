import { buildResumeArray, isInterruptExpired } from "@ag-ui/client";
import type {
  AbstractAgent,
  Interrupt,
  ResumeEntry,
  Message,
} from "@ag-ui/client";

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
  content: Extract<Message, { role: "tool" }>["content"];
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

/** Serialize a newly answered frontend call for the canonical message history. */
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
  readonly #responses: Record<string, ResumeResponse> = Object.create(null);
  #adoptedContent = new Map<string, ɵInterruptToolResult["content"]>();
  #pending: ɵPendingInterrupt<TValue> | null = null;
  #sealed = false;
  readonly #listeners = new Set<() => void>();

  /** Return the active normalized interrupt without exposing mutable state. */
  get pending(): ɵPendingInterrupt<TValue> | null {
    const pending = this.#pending;
    if (pending?.kind === "standard") {
      return { kind: "standard", interrupts: [...pending.interrupts] };
    }
    return pending;
  }

  /** Observe shared decisions without taking ownership of continuation. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Select the first unanswered interrupt; reading never claims a continuation. */
  nextInterrupt(messages: readonly Message[] = []): Interrupt | null {
    if (this.#pending?.kind !== "standard" || this.#sealed) return null;
    return (
      this.#pending.interrupts.find(
        (interrupt) =>
          !Object.prototype.hasOwnProperty.call(
            this.#responses,
            interrupt.id,
          ) && !this.isCompletedToolCall(interrupt.id, messages),
      ) ?? null
    );
  }

  #notify(): void {
    // Listeners may unsubscribe and resubscribe while handling a decision.
    const listeners = [...this.#listeners];
    for (const listener of listeners) listener();
  }

  /** Replace the current interrupt with a legacy custom-event interrupt. */
  setLegacy(event: ɵInterruptEvent<TValue>): void {
    this.#replace({ kind: "legacy", event });
  }

  /** Replace the current interrupt with an AG-UI standard interrupt set. */
  setStandard(interrupts: readonly Interrupt[]): void {
    const ids = new Set<string>();
    const callIds = new Set<string>();
    for (const interrupt of interrupts) {
      if (ids.has(interrupt.id))
        throw new Error(`Duplicate interrupt id: ${interrupt.id}`);
      ids.add(interrupt.id);
      if (interrupt.reason === "tool_call" && interrupt.toolCallId) {
        if (callIds.has(interrupt.toolCallId))
          throw new Error(
            `Duplicate interrupt tool call: ${interrupt.toolCallId}`,
          );
        callIds.add(interrupt.toolCallId);
      }
    }
    this.#replace({ kind: "standard", interrupts: [...interrupts] });
  }

  /** Clear all pending interrupt data and accumulated responses. */
  clear(): void {
    this.#pending = null;
    this.#sealed = false;
    this.#adoptedContent.clear();
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

  /** Reject ambiguous assistant definitions before executing or answering a call. */
  validateToolCalls(messages: readonly Message[]): void {
    if (this.#pending?.kind !== "standard") return;
    const pendingCalls = new Set(
      this.#pending.interrupts
        .filter((interrupt) => interrupt.reason === "tool_call")
        .map((interrupt) => interrupt.toolCallId),
    );
    const seen = new Set<string>();
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const call of message.toolCalls ?? []) {
        if (!pendingCalls.has(call.id)) continue;
        if (seen.has(call.id))
          throw new Error(`Duplicate tool call definition: ${call.id}`);
        seen.add(call.id);
      }
    }
  }

  /** Let UI adapters ignore explicit answers for successful frontend results. */
  isCompletedToolCall(
    interruptId: string | undefined,
    messages: readonly Message[],
  ): boolean {
    const pending = this.#pending;
    if (pending?.kind !== "standard") return false;
    const interrupt = pending.interrupts.find(
      (entry) => entry.id === interruptId,
    );
    if (interrupt?.reason !== "tool_call" || !interrupt.toolCallId)
      return false;
    // Do not hide duplicate results: resolve/cancel still reaches #decide's error.
    const results = this.#toolResults(interrupt.toolCallId, messages);
    const result = results[0];
    return (
      (results.length === 0 && this.#adoptedContent.has(interrupt.id)) ||
      (results.length === 1 &&
        result?.role === "tool" &&
        result.error === undefined)
    );
  }

  /** Resume only when saved frontend results answer every pending interrupt. */
  resumeWithToolResults(messages: readonly Message[]): ɵInterruptDecision {
    const pending = this.#pending;
    if (pending?.kind !== "standard" || this.#sealed)
      return { kind: "ignored" };
    return this.#decide(pending.interrupts, { ...this.#responses }, messages);
  }

  /** Start a new batch with no decisions retained from the preceding run. */
  #replace(pending: ɵPendingInterrupt<TValue>): void {
    this.clear();
    this.#pending = pending;
  }

  /** Record one explicit answer and reconcile it with saved frontend results. */
  #respond(
    interrupts: readonly Interrupt[],
    interruptId: string | undefined,
    response: ResumeResponse,
    messages: readonly Message[],
  ): ɵInterruptDecision {
    const id = interruptId ?? this.nextInterrupt(messages)?.id;
    // No-action decisions must not hide ambiguous history. Explicit unknown IDs
    // retain their existing ignored behavior; ordinary answers validate in #decide.
    if (id === undefined && interruptId === undefined) {
      this.validateToolCalls(messages);
      for (const interrupt of interrupts) {
        if (interrupt.reason !== "tool_call" || !interrupt.toolCallId) continue;
        this.#validatedToolResult(interrupt.toolCallId, messages);
      }
    }
    if (!id || !interrupts.some((interrupt) => interrupt.id === id)) {
      return { kind: "ignored" };
    }
    return this.#decide(
      interrupts,
      { ...this.#responses, [id]: response },
      messages,
    );
  }

  #toolResults(toolCallId: string, messages: readonly Message[]) {
    return messages.filter(
      (message): message is Extract<Message, { role: "tool" }> =>
        message.role === "tool" &&
        message.toolCallId === toolCallId &&
        !isForwardedToClientPlaceholder(message.content),
    );
  }

  #validatedToolResult(toolCallId: string, messages: readonly Message[]) {
    const results = this.#toolResults(toolCallId, messages);
    if (results.length > 1)
      throw new Error(`Duplicate tool results for ${toolCallId}`);
    return results[0];
  }

  /** Claim a complete batch once, preserving saved results and partial answers. */
  #decide(
    interrupts: readonly Interrupt[],
    responses: Record<string, ResumeResponse>,
    messages: readonly Message[],
  ): ɵInterruptDecision {
    this.validateToolCalls(messages);
    const completed = new Set<string>();
    // Stage adoption until every response validates, so a rejected decision
    // cannot leave cached content out of sync with accumulated responses.
    const adoptedContent = new Map(this.#adoptedContent);
    for (const interrupt of interrupts) {
      if (interrupt.reason !== "tool_call" || !interrupt.toolCallId) continue;
      const result = this.#validatedToolResult(interrupt.toolCallId, messages);
      if (!result && !adoptedContent.has(interrupt.id)) continue;
      const response = Object.prototype.hasOwnProperty.call(
        responses,
        interrupt.id,
      )
        ? responses[interrupt.id]
        : undefined;
      if (result?.role === "tool" && result.error !== undefined) {
        // Failure history remains intact; only an explicit decision can recover
        // this call. Do not append a second result for the same call ID.
        adoptedContent.delete(interrupt.id);
        completed.add(interrupt.id);
        continue;
      }
      const content = result
        ? result.content
        : adoptedContent.get(interrupt.id)!;
      if (
        response &&
        (response.status !== "resolved" ||
          (!sameValue(response.payload, content) &&
            toolResultContent(response) !== content))
      ) {
        throw new Error(
          `Interrupt response conflicts with existing tool result for ${interrupt.toolCallId}`,
        );
      }
      // Preserve actual result bytes, including the empty string. Never create
      // another tool message for a call already answered by a frontend handler.
      responses[interrupt.id] = { status: "resolved", payload: content };
      adoptedContent.set(interrupt.id, content);
      if (result) completed.add(interrupt.id);
    }
    Object.assign(this.#responses, responses);
    this.#adoptedContent = adoptedContent;
    if (
      !interrupts.every((interrupt) =>
        Object.prototype.hasOwnProperty.call(responses, interrupt.id),
      )
    ) {
      this.#notify();
      return { kind: "waiting" };
    }

    const expired = interrupts.find(
      (interrupt) =>
        responses[interrupt.id]?.status !== "cancelled" &&
        isInterruptExpired(interrupt),
    );
    if (expired) {
      this.#sealed = true;
      this.#notify();
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
          content: adoptedContent.has(interrupt.id)
            ? adoptedContent.get(interrupt.id)!
            : toolResultContent(responses[interrupt.id]!),
        },
      ];
    });
    this.#sealed = true;
    this.#notify();
    return { kind: "resume", resume, toolResults };
  }
}

/** Compare JSON protocol values without depending on object key insertion order. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        sameValue(a[key], b[key]),
    )
  );
}

const agentInterruptStates = new WeakMap<
  AbstractAgent,
  {
    threadId: string;
    interrupts: readonly Interrupt[];
    state: ɵInterruptState;
  }
>();

/** @internal Share decisions and the single resume claim for an agent's pending batch. */
export function ɵgetAgentInterruptState(
  agent: AbstractAgent,
  interrupts: readonly Interrupt[] = agent.pendingInterrupts,
): ɵInterruptState {
  const current = agentInterruptStates.get(agent);
  if (
    current &&
    current.threadId === agent.threadId &&
    current.state.pending &&
    sameValue(current.interrupts, interrupts)
  )
    return current.state;
  const state = new ɵInterruptState();
  state.setStandard(interrupts);
  agentInterruptStates.set(agent, {
    threadId: agent.threadId,
    interrupts: structuredClone(interrupts),
    state,
  });
  return state;
}

/** @internal A new run owns a new batch, even if the server reuses interrupt IDs. */
export function ɵclearAgentInterruptState(agent: AbstractAgent): void {
  agentInterruptStates.delete(agent);
}
