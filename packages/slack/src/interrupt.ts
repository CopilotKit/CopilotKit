import type { z } from "zod";
import type {
  HitlRenderApi,
  HitlRenderResult,
} from "./human-in-the-loop.js";

/**
 * Interrupt handler — the Slack-side equivalent of React's `useInterrupt`.
 *
 * When the agent's graph hits a LangGraph `interrupt(payload)` call, the
 * AG-UI runtime emits an `on_interrupt` custom event with the payload
 * and the run finalizes (paused, not finished). On Slack we want to:
 *
 *   1. capture that event,
 *   2. render a Block Kit picker based on the payload,
 *   3. wait for the user to click a button (each bound to a resume
 *      value via `api.respond(value)`),
 *   4. render the resolved state (typically a confirmation that
 *      replaces the picker), then
 *   5. resume the graph via `runAgent({forwardedProps: {command:
 *      {resume: value, interruptEvent}}})` — that `value` becomes the
 *      return value of the graph's `interrupt()` call.
 *
 * `PayloadSchema` is the Zod schema describing the agent's
 * `interrupt()` payload (input). The user's resume value (output of
 * `api.respond(value)`) is `unknown` on the type side; narrow inside
 * the resolved render based on the call-site shape.
 */
export interface InterruptHandler<
  PayloadSchema extends z.ZodType = z.ZodType,
> {
  /**
   * AG-UI custom event name to match. LangGraph + ag_ui_langgraph emits
   * `on_interrupt` by default, which is also our default here.
   */
  eventName?: string;
  /** Human-readable name — used in errors. */
  name: string;
  /** What the LLM sees if it ever inspects this (rarely matters; included for symmetry). */
  description: string;
  /** Zod schema describing the payload shape. Validation runs before render. */
  payload: PayloadSchema;
  /** Plain-text fallback for notifications. Falls back to `description`. */
  fallbackText?(payload: z.infer<PayloadSchema>): string;
  /**
   * Build the Block Kit message for the current state. Called once on
   * initial post (`status: "pending"`) and again on each resolution.
   */
  render(
    state: InterruptRenderState<PayloadSchema>,
    api: HitlRenderApi,
  ): HitlRenderResult;
}

/**
 * Discriminated state passed to `render`. On `pending`, `payload` is
 * the agent's interrupt() value. On `resolved`, `value` is whatever was
 * bound to the clicked element via `api.respond(value)` — typed as
 * `unknown`; narrow at the call site.
 */
export type InterruptRenderState<P extends z.ZodType> =
  | { status: "pending"; payload: z.infer<P> }
  | { status: "cancelled"; payload: z.infer<P> }
  | { status: "timeout"; payload: z.infer<P> }
  | { status: "resolved"; payload: z.infer<P>; value: unknown };

/** Identity factory — TS infers `PayloadSchema` from the `payload` field. */
export function defineInterruptHandler<PayloadSchema extends z.ZodType>(
  h: InterruptHandler<PayloadSchema>,
): InterruptHandler<PayloadSchema> {
  return h;
}

/** Default AG-UI custom-event name emitted by LangGraph interrupts. */
export const DEFAULT_INTERRUPT_EVENT_NAME = "on_interrupt";

/**
 * Captured interrupt — the renderer collects this from the AG-UI event
 * stream and the turn-runner consumes it after the run finalizes.
 */
export interface CapturedInterrupt {
  eventName: string;
  value: unknown;
}
