import type { Interrupt, ResumeEntry, RunAgentResult } from "@ag-ui/client";

export type { Interrupt, ResumeEntry };

/** Legacy custom-event interrupt payload (agent emits a custom `on_interrupt` event). */
export interface InterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}

/**
 * Resolve the agent with user input for an interrupt.
 *
 * - Standard interrupts: records `{ status: "resolved", payload }` for the target
 *   interrupt (defaults to the primary one). Resumes once every open interrupt is
 *   addressed; returns the resume run result, or `void` while still awaiting others.
 * - Legacy interrupts: resumes immediately via `command.resume = payload`.
 */
export type InterruptResolveFn = (
  payload?: unknown,
  interruptId?: string,
) => Promise<RunAgentResult | void>;

/**
 * Cancel an interrupt.
 *
 * - Standard interrupts: records `{ status: "cancelled" }` for the target interrupt
 *   (defaults to the primary one), then resumes once all are addressed.
 * - Legacy interrupts: dismisses the pending interrupt without resuming.
 */
export type InterruptCancelFn = (
  interruptId?: string,
) => Promise<RunAgentResult | void>;

export interface InterruptHandlerProps<TValue = unknown> {
  /**
   * Legacy event shape (`{ name, value }`). Always present for back-compat: for
   * standard interrupts, `value` is the primary `Interrupt` and `name` is `"on_interrupt"`.
   * Prefer `interrupt` / `interrupts` for standard interrupts.
   */
  event: InterruptEvent<TValue>;
  /** Primary standard interrupt (`interrupts[0]`), or `null` for legacy interrupts. */
  interrupt: Interrupt | null;
  /** All open standard interrupts (empty array for legacy interrupts). */
  interrupts: Interrupt[];
  resolve: InterruptResolveFn;
  cancel: InterruptCancelFn;
}

export interface InterruptRenderProps<TValue = unknown, TResult = unknown> {
  event: InterruptEvent<TValue>;
  interrupt: Interrupt | null;
  interrupts: Interrupt[];
  result: TResult;
  resolve: InterruptResolveFn;
  cancel: InterruptCancelFn;
}
