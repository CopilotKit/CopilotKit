/**
 * probe-session.ts — shared CVDIAG probe-layer session.
 *
 * `CvdiagProbeSession` owns the CVDIAG emit state for ONE probe level (one
 * `test_id`). It was originally an internal class of the d4 (e2e-smoke) driver;
 * it is extracted here so the d5/d6 (`d6-all-pills`) probe path can construct
 * the SAME session and emit the SAME 12 probe-layer boundaries (spec §3
 * Layer 1) — closing the gap where the flapping d5/d6 path produced NO
 * `cvdiag_events` `probe.exit` rows and so could not be read back from staging.
 *
 * The d4 driver re-imports every symbol here so its behavior is unchanged.
 *
 * Pure instrumentation: every method swallows its own errors — a CVDIAG fault
 * MUST NEVER throw into the probe it observes (spec §7 R5-F8).
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { truncateUtf8 } from "../render/filters.js";
import type { CvdiagEmitter } from "./emit.js";
import { mintSpanId } from "./emit.js";
import { filterEdgeHeaders } from "./edge-headers.js";
import { scrubSecrets } from "./scrub.js";
import type {
  CvdiagFailureClassifier,
  CvdiagOutcome,
  ProbeSseEventMeta,
  TerminationKind,
} from "./schema.js";
import { CVDIAG_FAILURE_CLASSIFIERS, isValidTestId } from "./schema.js";
import { mintTestId, sanitizeJoinTestId } from "./emit.js";

/**
 * SSE-event emit sampling target (spec §7 R5-F11): cap probe-side
 * `probe.sse.event` emits at ≤30/sec regardless of underlying SSE rate. Above
 * this rate, every Nth event is emitted; below it, every event.
 */
const CVDIAG_SSE_SAMPLE_TARGET_PER_SEC = 30;
/**
 * Class-(e) carve-out window (spec §7 R2-F19 rule 2): in the N ms immediately
 * preceding a `probe.exit` with `terminal_outcome=timeout`, EVERY
 * `probe.sse.event` is emitted regardless of rate, preserving the cross-layer
 * `sequence_num` join that detects dropped/reordered frontend events.
 */
const CVDIAG_PRE_TIMEOUT_WINDOW_MS = 5_000;
/** `probe.console.error.message_scrubbed` byte cap (spec §5). */
const CVDIAG_CONSOLE_MSG_CAP_BYTES = 512;
/** `probe.navigate.complete.url` byte cap (spec §5). */
const CVDIAG_URL_CAP_BYTES = 256;

/**
 * Normalized HTTP-response shape the driver reads for `probe.network.response`
 * and `probe.message.send` edge-header capture. The launcher adapts
 * Playwright's `Response` onto this minimal surface so the driver stays
 * decoupled from the Playwright type tree (and fakes can hand one in).
 */
export interface CvdiagResponseEvent {
  url: string;
  status: number;
  /** Raw header bag (case-insensitive keys); filtered to the 9-key allow-list. */
  headers: Record<string, string | null | undefined>;
  contentLength: number | null;
  durationMs: number;
  /** True iff this is the agent-message POST (drives `probe.message.send`). */
  isMessagePost?: boolean;
  /**
   * DEBUG-tier raw-byte capture (L2-C / Phase 2.5) seam: lazily reads the
   * literal (possibly compressed) response body. Present ONLY when the
   * launcher wires Playwright's `Response.body()`; absent on fake pages (which
   * therefore never trigger a raw-byte capture). Best-effort — resolves null
   * on any read failure so it never throws into the probe.
   */
  body?: () => Promise<Buffer | null>;
}

/** Normalized failed-request shape for `probe.network.error`. */
export interface CvdiagRequestFailedEvent {
  url: string;
  errorClass: string;
  responseStatus: number | null;
}

/** Normalized console-message shape for `probe.console.error`. */
export interface CvdiagConsoleEvent {
  level: "warning" | "error";
  /** Raw (un-scrubbed) text; the driver scrubs + caps before emit. */
  text: string;
  sourceFile: string | null;
  lineCol: string | null;
}

/** Normalized SSE-event shape for `probe.sse.event`. */
export interface CvdiagSseEvent {
  eventType: string;
  payloadSizeBytes: number;
}

/** Normalized SSE-abort shape for `probe.sse.aborted`. */
export interface CvdiagSseAbortedEvent {
  terminationKind: TerminationKind;
  bytesBeforeAbort: number;
}

/** A single buffered SSE event awaiting sample/carve-out decision. */
interface PendingSseEvent {
  eventType: string;
  payloadSizeBytes: number;
  /** Wall-clock ms when observed (for the pre-timeout carve-out window). */
  atMs: number;
  /**
   * The `sequence_num` minted at OBSERVE time (chronological), NOT at emit
   * time. Every observed SSE event reserves its seq the moment it arrives, so
   * the carve-out backfill (which emits dropped events on a timeout exit)
   * carries each event's ORIGINAL chronological seq. Minting a FRESH seq at
   * backfill time sorted the backfilled (lower-in-time) events AFTER the live
   * ones — defeating the reorder/drop detection the carve-out exists for. The
   * seq is reserved here regardless of whether the event is emitted live so a
   * later backfill can replay it in the original order.
   */
  seq: number;
  /**
   * True iff this event was ALREADY emitted live (passed the §7 sampling
   * stride). The timeout carve-out flushes only events that were NOT emitted
   * live, so a sampled-through event is never emitted twice (no duplicate
   * `probe.sse.event` rows, no inflated `sse_event_count`).
   */
  emittedLive: boolean;
}

/**
 * `CvdiagProbeSession` — owns the CVDIAG emit state for ONE probe level (one
 * `test_id`). It threads the shared `test_id` through all 12 probe-layer
 * boundaries (spec §3 Layer 1), maintains per-`(test_id, boundary-family)`
 * `sequence_num` counters (spec §5 R3-F16), mints `span_id`/`parent_span_id`
 * per emit, applies the §7 SSE-rate sampling + the class-(e) pre-timeout
 * carve-out, and buffers every emitted envelope to a replay-fallback ndjson
 * file (spec §4 / §1.5).
 *
 * Pure instrumentation: every method swallows its own errors — a CVDIAG fault
 * MUST NEVER throw into the probe it observes (spec §7 R5-F8).
 */
export class CvdiagProbeSession {
  private readonly emitter: CvdiagEmitter;
  private readonly testId: string;
  private readonly slug: string;
  private readonly demo: string;
  private readonly bufferDir: string;
  private readonly startMonoMs: number;
  /** Root span minted at `probe.start`; parents the per-boundary spans. */
  private readonly rootSpanId = mintSpanId();
  /** Per-boundary-family monotonic sequence counters, reset per test_id. */
  private readonly sequenceByFamily = new Map<string, number>();
  /** Rolling window of recently-observed SSE events (carve-out support). */
  private readonly pendingSse: PendingSseEvent[] = [];
  /** Sampling cursor: emit every Nth event when over the rate target. */
  private sseSeenInWindow = 0;
  private sseWindowStartMs = 0;
  private firstTokenDeltaMs: number | null = null;
  private sseEmittedCount = 0;

  constructor(opts: {
    emitter: CvdiagEmitter;
    testId: string;
    slug: string;
    demo: string;
    bufferDir: string;
    nowMs: number;
  }) {
    this.emitter = opts.emitter;
    // Resolve ONE stable test_id for the whole session — the CROSS-LAYER JOIN
    // KEY (spec §5). The probe's X-Test-Id is `d4-<slug>-<runId>` /
    // `d6-<slug>-<runId>`, NOT a UUIDv7. It is forwarded verbatim as the
    // `X-Test-Id` request header, and the backend ADOPTS that inbound header as
    // its OWN cvdiag `test_id`, normalizing it through `sanitizeJoinTestId`. So
    // the probe MUST record the SAME normalized value — `sanitizeJoinTestId`
    // applied to the SAME forwarded id — for probe.* rows to JOIN backend.* rows
    // on `test_id`. Recording a fresh random UUIDv7 here (the pre-fix behavior)
    // gave probe rows an id the backend never derives, so the join never closed.
    //
    // Resolution order (all branches yield ONE stable id threaded through every
    // emit() + the raw-byte sample, so intra-layer rows stay correlated too):
    //   1. a value already a valid UUIDv7 → keep it verbatim (legacy callers
    //      that mint a UUIDv7 up front; `sanitizeJoinTestId` only runs on
    //      genuinely non-UUIDv7 inputs, matching the emitter/backend contract);
    //   2. else sanitize the forwarded id the SAME way the backend does — this
    //      is the join key both sides share;
    //   3. else (nothing survives sanitization) mint a fresh UUIDv7 fallback so
    //      every row still carries a valid, stable id.
    this.testId = isValidTestId(opts.testId)
      ? opts.testId
      : (sanitizeJoinTestId(opts.testId) ?? mintTestId());
    this.slug = opts.slug;
    this.demo = opts.demo;
    this.bufferDir = opts.bufferDir;
    this.startMonoMs = opts.nowMs;
    this.sseWindowStartMs = opts.nowMs;
  }

  /**
   * The resolved, stable session test_id (a valid UUIDv7) that every emitted
   * `cvdiag_events` row for this level carries. Callers (e.g. the DEBUG-tier
   * raw-byte capture) MUST use this — not the raw `d4-<slug>-<runId>`
   * X-Test-Id — so `cvdiag_raw_byte_samples.test_id` joins back to the events.
   */
  get resolvedTestId(): string {
    return this.testId;
  }

  /**
   * Next monotonic `sequence_num` for a boundary family (spec §5 R3-F16:
   * per-`(test_id, layer, boundary-family)`, starting at 0). The session is
   * already scoped to one `(test_id, layer=probe)`, so we key on the family.
   */
  private nextSeq(family: string): number {
    const cur = this.sequenceByFamily.get(family) ?? 0;
    this.sequenceByFamily.set(family, cur + 1);
    return cur;
  }

  /** Core emit + ndjson-buffer wrapper. Swallows all faults. */
  private fire(args: {
    boundary: Parameters<CvdiagEmitter["emit"]>[0]["boundary"];
    outcome: CvdiagOutcome;
    metadata?: Record<string, unknown>;
    edgeHeaders?: ReturnType<typeof filterEdgeHeaders>;
    durationMs?: number | null;
  }): void {
    try {
      const env = this.emitter.emit({
        layer: "probe",
        boundary: args.boundary,
        slug: this.slug,
        demo: this.demo,
        outcome: args.outcome,
        metadata: args.metadata,
        edgeHeaders: args.edgeHeaders,
        durationMs: args.durationMs ?? null,
        parentSpanId: this.rootSpanId,
        testId: this.testId,
      });
      if (env) void this.buffer(env);
    } catch {
      /* pure instrumentation — never throw into the probe */
    }
  }

  /** Append one emitted envelope to the replay-fallback ndjson buffer. */
  private async buffer(env: { ts: string }): Promise<void> {
    try {
      const date = env.ts.slice(0, 10); // YYYY-MM-DD
      const dir = path.join(this.bufferDir, date);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${this.testId}.ndjson`);
      await fs.appendFile(file, `${JSON.stringify(env)}\n`, "utf8");
    } catch {
      /* best-effort — a buffer write must never break a probe */
    }
  }

  // ── Boundary emitters ─────────────────────────────────────────────────────

  start(url: string, viewport: { width: number; height: number }): void {
    this.fire({
      boundary: "probe.start",
      outcome: "info",
      metadata: { url: truncateUtf8(url, CVDIAG_URL_CAP_BYTES), viewport },
    });
  }

  navigateComplete(
    url: string,
    navMs: number | null,
    httpStatus: number | null,
  ): void {
    this.fire({
      boundary: "probe.navigate.complete",
      outcome: httpStatus !== null && httpStatus >= 400 ? "err" : "ok",
      durationMs: navMs,
      metadata: {
        url: truncateUtf8(url, CVDIAG_URL_CAP_BYTES),
        nav_ms: navMs,
        http_status: httpStatus,
      },
    });
  }

  messageSend(
    messageIndex: number,
    charCount: number,
    edge?: ReturnType<typeof filterEdgeHeaders>,
  ): void {
    this.fire({
      boundary: "probe.message.send",
      outcome: "ok",
      edgeHeaders: edge,
      metadata: {
        message_index: messageIndex,
        char_count: charCount,
        demo: this.demo,
      },
    });
  }

  containerMount(nowMs: number): void {
    this.fire({
      boundary: "probe.dom.container.mount",
      outcome: "ok",
      metadata: { delta_ms_from_start: Math.max(0, nowMs - this.startMonoMs) },
    });
  }

  firstToken(nowMs: number, textLength: number): void {
    const delta = Math.max(0, nowMs - this.startMonoMs);
    this.firstTokenDeltaMs = delta;
    this.fire({
      boundary: "probe.dom.firsttoken",
      outcome: "ok",
      metadata: { delta_ms_from_start: delta, text_length: textLength },
    });
  }

  /** Emitted on a terminal exit whose assistant text stayed empty (class (d)). */
  alternateContent(childTypeHistogram: Record<string, number>): void {
    this.fire({
      boundary: "probe.dom.alternate_content",
      outcome: "info",
      metadata: { child_type_histogram: childTypeHistogram },
    });
  }

  networkResponse(evt: CvdiagResponseEvent): void {
    this.fire({
      boundary: "probe.network.response",
      outcome: evt.status >= 400 ? "err" : "ok",
      durationMs: evt.durationMs,
      edgeHeaders: filterEdgeHeaders(evt.headers),
      metadata: {
        url: truncateUtf8(evt.url, CVDIAG_URL_CAP_BYTES),
        status: evt.status,
        content_length: evt.contentLength,
        duration_ms: evt.durationMs,
      },
    });
  }

  networkError(evt: CvdiagRequestFailedEvent): void {
    this.fire({
      boundary: "probe.network.error",
      outcome: "err",
      metadata: {
        url: truncateUtf8(evt.url, CVDIAG_URL_CAP_BYTES),
        error_class: evt.errorClass,
        response_status: evt.responseStatus,
      },
    });
  }

  consoleError(evt: CvdiagConsoleEvent): void {
    // Scrub secrets BEFORE the byte cap so a truncation can never split a
    // partially-scrubbed token and leak the tail.
    const scrubbed = truncateUtf8(
      scrubSecrets(evt.text),
      CVDIAG_CONSOLE_MSG_CAP_BYTES,
    );
    this.fire({
      boundary: "probe.console.error",
      outcome: evt.level === "error" ? "err" : "info",
      metadata: {
        level: evt.level,
        message_scrubbed: scrubbed,
        source_file: evt.sourceFile,
        line_col: evt.lineCol,
      },
    });
  }

  /**
   * Observe one SSE event. Applies §7 rate sampling (≤30 emit/sec); over the
   * rate, only every Nth event is emitted. ALL observed events are retained in
   * a rolling pre-timeout window so a subsequent timeout exit can flush the
   * full unsampled set (class-(e) carve-out, rule 2).
   */
  sseEvent(evt: CvdiagSseEvent, nowMs: number): void {
    // Roll the 1-second sampling window.
    if (nowMs - this.sseWindowStartMs >= 1000) {
      this.sseWindowStartMs = nowMs;
      this.sseSeenInWindow = 0;
    }
    this.sseSeenInWindow += 1;
    // Reserve the chronological `sequence_num` for THIS event at observe time,
    // regardless of whether it is emitted live or dropped by the §7 sampling
    // stride. A later timeout carve-out backfills dropped events with this
    // ORIGINAL seq so the cross-layer join sorts them in true arrival order —
    // minting a fresh seq at backfill time put them AFTER the live events.
    const pending: PendingSseEvent = {
      eventType: evt.eventType,
      payloadSizeBytes: evt.payloadSizeBytes,
      atMs: nowMs,
      seq: this.nextSeq("sse"),
      emittedLive: false,
    };
    this.pendingSse.push(pending);
    // Trim the rolling window to the carve-out horizon to bound memory.
    const cutoff = nowMs - CVDIAG_PRE_TIMEOUT_WINDOW_MS;
    while (this.pendingSse.length > 0 && this.pendingSse[0]!.atMs < cutoff) {
      this.pendingSse.shift();
    }
    // Sampling decision: under target → emit every event; over → every Nth.
    const overRate = this.sseSeenInWindow > CVDIAG_SSE_SAMPLE_TARGET_PER_SEC;
    const stride = overRate
      ? Math.ceil(this.sseSeenInWindow / CVDIAG_SSE_SAMPLE_TARGET_PER_SEC)
      : 1;
    if (this.sseSeenInWindow % stride === 0) {
      this.emitSse(evt.eventType, evt.payloadSizeBytes, pending.seq);
      // Mark so the timeout carve-out below does NOT re-emit this event (it
      // was already counted in `sseEmittedCount` and emitted as a row).
      pending.emittedLive = true;
    }
  }

  private emitSse(
    eventType: string,
    payloadSizeBytes: number,
    seq: number,
  ): void {
    const metadata: ProbeSseEventMeta = {
      event_type: eventType,
      payload_size_bytes: payloadSizeBytes,
      sequence_num: seq,
    };
    this.fire({
      boundary: "probe.sse.event",
      outcome: "info",
      metadata: metadata as unknown as Record<string, unknown>,
    });
    this.sseEmittedCount += 1;
  }

  sseAborted(evt: CvdiagSseAbortedEvent): void {
    this.fire({
      boundary: "probe.sse.aborted",
      outcome: "err",
      metadata: {
        termination_kind: evt.terminationKind,
        bytes_before_abort: evt.bytesBeforeAbort,
      },
    });
  }

  /**
   * Terminal `probe.exit`. On a `timeout` outcome, first flush the entire
   * pre-timeout SSE window UNSAMPLED (class-(e) carve-out rule 2) so the
   * cross-layer `sequence_num` join is complete, THEN emit `probe.exit`.
   *
   * `failureClassifier` labels WHY a non-`ok` run failed. When the caller has
   * the authoritative reason (e.g. `waitForTurnComplete`'s
   * `TurnNotCompleteError.reason`) it passes it explicitly; otherwise, for a
   * non-`ok` outcome, this derives a best-effort classifier from the probe's
   * OWN observed signals (no SSE => `sse-missing`; SSE seen but no DOM
   * first-token => `dom-missing`; else `text-unstable`) so reds are always
   * labeled in cvdiag probe data. An `ok` outcome NEVER carries a classifier.
   */
  exit(
    terminalOutcome: CvdiagOutcome,
    totalDurationMs: number,
    failureClassifier?: CvdiagFailureClassifier,
  ): void {
    if (terminalOutcome === "timeout") {
      // Flush ONLY events not already emitted live. Re-emitting the full
      // buffered window (including the already-live-emitted subset) duplicated
      // `probe.sse.event` rows and inflated `sse_event_count`; the carve-out's
      // job is to backfill the events the §7 sampling stride DROPPED, not to
      // re-emit the ones it let through.
      for (const ev of this.pendingSse) {
        if (!ev.emittedLive) {
          // Backfill with the event's ORIGINAL observe-time seq so it sorts in
          // true chronological order alongside the live-emitted events — a
          // fresh seq minted here would sort the (earlier) dropped events AFTER
          // the (later) live ones, defeating the reorder/drop detection.
          this.emitSse(ev.eventType, ev.payloadSizeBytes, ev.seq);
        }
      }
      this.pendingSse.length = 0;
    }
    // Label the failure. An explicit reason (from the caller, e.g.
    // `waitForTurnComplete`'s reject `reason`) wins; otherwise derive a
    // best-effort classifier from this probe's own observed signals. `ok`
    // runs never carry a classifier (greens stay unlabeled).
    const resolvedClassifier: CvdiagFailureClassifier | undefined =
      terminalOutcome === "ok"
        ? undefined
        : (failureClassifier ?? this.deriveFailureClassifier());
    this.fire({
      boundary: "probe.exit",
      outcome: terminalOutcome,
      durationMs: totalDurationMs,
      metadata: {
        terminal_outcome: terminalOutcome,
        total_duration_ms: totalDurationMs,
        sse_event_count: this.sseEmittedCount,
        first_token_delta_ms: this.firstTokenDeltaMs,
        // Only present on a non-`ok` outcome (undefined keys are dropped by
        // the emit-time metadata validator, so greens carry no classifier).
        ...(resolvedClassifier !== undefined
          ? { failure_classifier: resolvedClassifier }
          : {}),
      },
    });
  }

  /**
   * Best-effort failure classifier from the probe's OWN observed signals,
   * mirroring `waitForTurnComplete`'s precedence (earliest-missing signal
   * wins): no SSE event => `sse-missing`; SSE seen but no DOM first-token =>
   * `dom-missing`; SSE + first-token both seen but the run still failed (the
   * text never settled / assertion red) => `text-unstable`.
   */
  private deriveFailureClassifier(): CvdiagFailureClassifier {
    if (this.sseEmittedCount === 0) return "sse-missing";
    if (this.firstTokenDeltaMs === null) return "dom-missing";
    return "text-unstable";
  }
}

/** Default replay-fallback ndjson buffer root (spec §4 `~/.cvdiag/buffer`). */
export function defaultCvdiagBufferDir(): string {
  return path.join(os.homedir(), ".cvdiag", "buffer");
}

/**
 * Monotonic wall-clock ms for CVDIAG delta computations
 * (`delta_ms_from_start`, the SSE sampling window, the pre-timeout carve-out).
 * `performance.now()` is monotonic and immune to wall-clock skew — the right
 * source for intra-probe durations.
 */
export function nowMonoMs(): number {
  return performance.now();
}

/**
 * Set of valid CVDIAG failure classifiers, for the duck-typed
 * `TurnNotCompleteError.reason` guard below AND for the d6 driver's
 * conversation-error `reason=<classifier>` breadcrumb parse. Derived from the
 * schema's canonical `CVDIAG_FAILURE_CLASSIFIERS` const so the allow-list can
 * NEVER drift from the `CvdiagFailureClassifier` union — adding a classifier
 * to the schema array automatically widens every membership check.
 */
export const FAILURE_CLASSIFIER_SET: ReadonlySet<CvdiagFailureClassifier> =
  new Set(CVDIAG_FAILURE_CLASSIFIERS);

/**
 * Extract a CVDIAG failure classifier from a thrown error when it is a
 * `waitForTurnComplete` `TurnNotCompleteError` (duck-typed via its `reason`
 * field so this module stays decoupled from conversation-runner). Returns
 * `undefined` for any other throw, leaving the session to derive a best-effort
 * classifier from its own observed signals.
 */
export function turnCompleteReason(
  err: unknown,
): CvdiagFailureClassifier | undefined {
  if (
    typeof err === "object" &&
    err !== null &&
    "reason" in err &&
    typeof (err as { reason: unknown }).reason === "string"
  ) {
    const reason = (err as { reason: string }).reason;
    if (FAILURE_CLASSIFIER_SET.has(reason as CvdiagFailureClassifier)) {
      return reason as CvdiagFailureClassifier;
    }
  }
  return undefined;
}
