/**
 * cv-diag.ts — the SHARED CVDIAG diagnostic contract for the
 * context-value (CV) propagation incident instrumentation.
 *
 * WHY this module exists: the CV-propagation bug (#cvdiag) is a
 * mid-incident, multi-hop visibility problem — a request's `x-aimock-context`
 * slug must survive every boundary (inbound HTTP → AsyncLocalStorage snapshot
 * → configurable read → contextvar capture → outbound LLM → fixture match →
 * verdict) and the load-bearing failure signal is the header simply going
 * MISSING at some hop. Each instrumenting slot emits a single-line,
 * grep-anchored CVDIAG record at its boundary so the whole chain is
 * reconstructable from stdout alone. This module is the ONE place the line
 * format and the header names are defined, so every slot agrees byte-for-byte
 * — a divergent format would defeat `grep CVDIAG` correlation.
 *
 * PRIVACY INVARIANT: the `x-aimock-context` slug is a NON-SECRET aimock
 * routing identifier and is emitted IN FULL in the `slug=` field; the
 * separate `header_value_prefix=` field is a 12-char echo of that same slug
 * (kept for back-compat with existing greps, NOT a redaction of `slug=`).
 * Because the slug is logged verbatim, callers MUST NOT route secrets or
 * credentials through `aimockContext` — it is for the routing discriminator
 * only. Slots MUST go through `formatCvdiag` rather than hand-rolling the
 * line, so the single-line grep contract and field order can never be
 * bypassed.
 *
 * DUAL-PATH INVARIANT: emit on BOTH the success AND the miss/error path.
 * `header_present=false` is the signal that localizes WHERE the slug was
 * dropped; suppressing the line on the miss path hides exactly the event the
 * instrumentation exists to catch.
 */

import crypto from "node:crypto";

/**
 * Request header carrying the aimock routing slug whose propagation we are
 * tracing. Lower-cased to match Node/undici's normalized header keys.
 */
export const X_AIMOCK_CONTEXT = "x-aimock-context";

/**
 * Per-trace correlation id minted at the inbound boundary (`mintRunId`) and
 * threaded through subsequent hops so a single request's CVDIAG lines share a
 * `run_id`.
 */
export const X_DIAG_RUN_ID = "x-diag-run-id";

/**
 * Breadcrumb header accumulating the ordered list of boundaries a request has
 * already crossed (comma-joined, see `appendHop`). Lets a downstream hop log
 * the path that reached it without a central store.
 */
export const X_DIAG_HOPS = "x-diag-hops";

/** Canonical boundary names a CVDIAG line can be emitted at. */
export type CvdiagBoundary =
  | "inbound"
  | "als-snapshot"
  | "configurable-read"
  | "contextvar-capture"
  | "outbound-llm"
  | "fixture-match"
  | "cv-verdict"
  // Harness-internal / operational events (pb-create failures, pool
  // transitions, backup failures) that are NOT a propagation-chain boundary.
  // Kept distinct so they stop overloading `als-snapshot`.
  | "ops";

/** Canonical per-boundary outcome. */
export type CvdiagStatus = "ok" | "miss" | "error";

/**
 * Inputs to a single CVDIAG line. The formatter — not the caller — derives the
 * redacted prefix and the present/missing flag, so the privacy + dual-path
 * invariants hold uniformly.
 */
export interface CvdiagFields {
  /** Emitting component (module / driver / boundary owner). */
  component: string;
  /** Which boundary in the propagation chain this line records. */
  boundary: CvdiagBoundary;
  /** Value of the `x-diag-run-id` header for this request, if present. */
  runId?: string;
  /** Raw `x-aimock-context` header value (redacted to a 12-char prefix). */
  aimockContext?: string;
  /** Monotonic hop index for this boundary, if the caller tracks one. */
  hop?: number;
  /** Per-boundary outcome. */
  status: CvdiagStatus;
  /** Value of the `x-test-id` header for this request, if present. */
  testId?: string;
  /** Short error summary on the error path (never a full stack / payload). */
  error?: string;
}

/** Max chars of the slug echoed into `header_value_prefix`. */
const HEADER_VALUE_PREFIX_LEN = 12;

/**
 * Collapse CR/LF (and any other newline) in a free-text field to a single
 * space so a multi-line value (e.g. an Error stack threaded through `error=`)
 * can never break the single-line, space-separated grep contract.
 */
function sanitizeField(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/**
 * Render the canonical single-line CVDIAG record. Space-separated
 * `key=value`, anchored by the literal `CVDIAG` tag so the whole propagation
 * chain is greppable. Field order is fixed (do NOT reorder — downstream
 * parsing/grepping relies on it).
 *
 * Redaction and the present/missing derivation live HERE so no slot can leak a
 * full header value or skip the load-bearing `header_present=false` signal.
 */
export function formatCvdiag(fields: CvdiagFields): string {
  const headerPresent = typeof fields.aimockContext === "string";
  const rawSlug = headerPresent ? (fields.aimockContext as string) : "";
  const prefix = sanitizeField(rawSlug.slice(0, HEADER_VALUE_PREFIX_LEN));
  return [
    "CVDIAG",
    // component is a free-text field (callers pass arbitrary owner labels).
    `component=${sanitizeField(fields.component)}`,
    `boundary=${fields.boundary}`,
    `run_id=${fields.runId ?? "none"}`,
    `slug=${headerPresent ? sanitizeField(rawSlug) : "MISSING"}`,
    `header_present=${headerPresent ? "true" : "false"}`,
    `header_value_prefix=${prefix}`,
    `hop=${fields.hop ?? "-"}`,
    `status=${fields.status}`,
    // test_id is caller-supplied free text.
    `test_id=${fields.testId ? sanitizeField(fields.testId) : "none"}`,
    // error commonly carries an Error message/stack — strip newlines so a
    // multi-line stack can never split the single-line record.
    `error=${fields.error ? sanitizeField(fields.error) : ""}`,
  ].join(" ");
}

/**
 * Comma-join a new hop `tag` onto an existing `x-diag-hops` header value,
 * preserving order. An empty/undefined existing value yields just the tag, so
 * the inbound boundary can seed the breadcrumb without a special case.
 */
export function appendHop(
  existingHopsHeader: string | undefined,
  tag: string,
): string {
  const existing = existingHopsHeader?.trim();
  return existing ? `${existing},${tag}` : tag;
}

/** Mint a fresh per-trace correlation id for the `x-diag-run-id` header. */
export function mintRunId(): string {
  return crypto.randomUUID();
}
