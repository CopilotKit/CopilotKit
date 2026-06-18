import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { truncateUtf8 } from "../../render/filters.js";
import {
  resolveShape,
  showcaseShapeSchema,
} from "../discovery/railway-services.js";
import type { BrowserPool } from "../helpers/browser-pool.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";
import { mintRunId } from "../helpers/cv-diag.js";
import {
  CvdiagEmitter,
  filterEdgeHeaders,
  mintSpanId,
  scrubSecrets,
} from "../../cvdiag/index.js";
import type {
  CvdiagEnvelope,
  CvdiagOutcome,
  ProbeSseEventMeta,
  TerminationKind,
} from "../../cvdiag/index.js";

/**
 * e2e-smoke driver — L3 (chat round-trip) and L4 (tool rendering) coverage
 * against each discovered showcase service. The driver launches a single
 * Chromium instance per invocation, navigates the deployed frontend at
 * `<backendUrl>/demos/<demo>`, sends a chat message, and asserts on the
 * response content.
 *
 * Three ProbeResults flow out of one invocation:
 *   - `e2e-smoke:<slug>` (aggregate, returned): green iff every level that
 *     ran passed; red otherwise. This is what the invoker's
 *     `writer.write()` picks up as the primary tick.
 *   - `chat:<slug>` (L3, side-emitted via ctx.writer): reflects the L3
 *     round-trip result in isolation so dashboards can distinguish "chat
 *     alone is broken" from "tool rendering is broken".
 *   - `tools:<slug>` (L4, side-emitted) — only when `demos.includes("tool-rendering")`.
 *     Absent for services that don't expose the tool-rendering demo.
 *
 * In-process vs spawn: the orchestrator already runs as a long-lived Node
 * process with `playwright` installed (see Dockerfile). Launching chromium
 * directly via `playwright.chromium.launch()` keeps the browser in-process
 * rather than having to kill a child process. Note: the `defaultLauncher`
 * does NOT wire the AbortSignal — it dedicates a chromium per call and lets
 * the driver's teardown close it. The POOLED launcher
 * (`createPooledE2eSmokeLauncher`) is the path that actually re-targets abort
 * onto open contexts for prompt pool release.
 *
 * Pluggable launcher: the production default imports `playwright` lazily
 * so the driver module loads cleanly in environments without chromium
 * (unit-test runs). Tests inject a fake launcher that produces a fake
 * Page, exercising the driver's adapter logic without touching a real
 * browser.
 */

const inputSchema = z
  .object({
    key: z.string().min(1),
    // `publicUrl` is the field the railway-services discovery source
    // populates with `https://<domain>` for each service. A static
    // `backendUrl` can be used as an alias so hand-wired YAML targets
    // don't have to match discovery's naming. The driver prefers
    // `backendUrl` when both are present.
    backendUrl: z.string().url().optional(),
    publicUrl: z.string().url().optional(),
    // Service name from Railway (e.g. "showcase-langgraph-python"). Used
    // to derive the slug for registry lookup when `demos` isn't supplied
    // in-band. Optional so static YAML targets can skip it.
    name: z.string().optional(),
    // Pre-resolved demos array — skips the registry lookup. Primarily
    // used by tests and by static-target YAML. Discovery-fed invocations
    // usually leave this undefined and let the driver resolve via the
    // registry.
    demos: z.array(z.string()).optional(),
    /**
     * Deployment shape tag from the discovery source. Only `"package"`
     * shape exists.
     *
     * Optional — when absent the driver defaults to `"package"`.
     */
    shape: showcaseShapeSchema.optional(),
  })
  .passthrough()
  .refine((v) => !!(v.backendUrl ?? v.publicUrl), {
    message: "backendUrl or publicUrl is required",
    path: ["backendUrl"],
  });

type E2eSmokeDriverInput = z.infer<typeof inputSchema>;

/**
 * Aggregate signal shape for the primary `e2e-smoke:<slug>` result.
 * All services are `shape: "package"` — the driver runs Playwright
 * against `/demos/*`. `l3` is `green` or `red`; `l4` can also be
 * `skipped` when the registry entry has no `tool-rendering` demo. A
 * red row may carry an `errorDesc` keyed to the failure class
 * (`launcher-error`, `timeout`, `driver-error`, or absent when the
 * failure lives in `failureSummary`).
 */
export type E2eSmokeSignal = E2eSmokePackageSignal;

export interface E2eSmokePackageSignal {
  shape: "package";
  slug: string;
  backendUrl: string;
  /**
   * Per-level outcome.
   *   - "green" / "red"  standard probe result
   *   - "skipped"        L4 only — set when the registry entry has no
   *                      `tool-rendering` demo.
   */
  l3: "green" | "red";
  l4: "green" | "red" | "skipped";
  failureSummary: string;
  errorDesc?: string;
}

/** Per-level side-emit signal — one shape for both `chat:<slug>` and `tools:<slug>`. */
export interface E2eSmokeLevelSignal {
  slug: string;
  backendUrl: string;
  level: "chat" | "tools";
  responseText?: string;
  failureSummary: string;
  errorDesc?: string;
}

/**
 * Minimal Page surface the driver relies on. Captured here rather than
 * imported from `playwright` so unit tests can hand in a stub without
 * pulling the full runtime type tree (which carries ESM/CJS conditionals
 * that trip vitest's module loader on certain Node versions).
 */
export interface E2ePage {
  goto(
    url: string,
    opts?: {
      waitUntil?: "networkidle" | "domcontentloaded" | "load";
      timeout?: number;
    },
  ): Promise<unknown>;
  type(
    selector: string,
    text: string,
    opts?: { timeout?: number },
  ): Promise<void>;
  press(
    selector: string,
    key: string,
    opts?: { timeout?: number },
  ): Promise<void>;
  waitForSelector(
    selector: string,
    opts?: { timeout?: number; state?: "visible" },
  ): Promise<unknown>;
  textContent(selector: string): Promise<string | null>;
  /**
   * Run a function in the browser page context. Used for DOM reads that
   * must NOT auto-wait (Playwright's `page.textContent(selector)` waits
   * up to 30 s for the selector to match; `evaluate` returns immediately
   * with whatever the DOM currently holds).
   */
  evaluate<R>(fn: () => R): Promise<R>;
  close(): Promise<void>;

  // ── CVDIAG event-source seams (optional) ─────────────────────────────────
  //
  // The real launchers wire these to Playwright's `page.on("response")`,
  // `page.on("requestfailed")`, `page.on("console")`, plus the CDP-backed
  // SSE interceptor (see helpers/sse-interceptor.ts). They are OPTIONAL so a
  // fake page that doesn't model the network/console/SSE surface still
  // satisfies the interface; the driver only emits the corresponding CVDIAG
  // boundary when the seam is present. Tests inject fakes that invoke the
  // registered handler synthetically to drive a specific boundary.

  /** Register a handler invoked for every HTTP response observed. */
  onResponse?(handler: (resp: CvdiagResponseEvent) => void): void;
  /** Register a handler invoked for every failed network request. */
  onRequestFailed?(handler: (req: CvdiagRequestFailedEvent) => void): void;
  /** Register a handler invoked for every browser console message. */
  onConsole?(handler: (msg: CvdiagConsoleEvent) => void): void;
  /** Register a handler invoked for every observed SSE event. */
  onSseEvent?(handler: (evt: CvdiagSseEvent) => void): void;
  /** Register a handler invoked when an SSE stream aborts abnormally. */
  onSseAborted?(handler: (evt: CvdiagSseAbortedEvent) => void): void;
}

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

export interface E2eBrowserContext {
  newPage(): Promise<E2ePage>;
  close(): Promise<void>;
}

export interface E2eBrowser {
  newContext(ctxOpts?: {
    extraHTTPHeaders?: Record<string, string>;
  }): Promise<E2eBrowserContext>;
  close(): Promise<void>;
}

/**
 * Launcher injection seam. Production uses `defaultLauncher` which
 * dynamically imports `playwright` and calls `chromium.launch()`; tests
 * substitute a fake that returns a scripted E2eBrowser.
 */
export type E2eBrowserLauncher = (
  abortSignal?: AbortSignal,
) => Promise<E2eBrowser>;

/**
 * Resolver that maps a Railway service slug to its `demos` array, used
 * when the input didn't carry `demos` directly (discovery-fed case).
 * Production reads `/app/data/registry.json`, tests inject a pure fn.
 * Returns `[]` when the slug is unknown — unknown slug equals "no L4"
 * rather than an error because discovery can produce services that
 * haven't landed in the registry yet (new showcase being rolled out).
 */
export type DemosResolver = (slug: string) => Promise<string[]>;

export interface E2eSmokeDriverDeps {
  /** Browser launcher. Defaults to the real chromium launcher. */
  launcher?: E2eBrowserLauncher;
  /** Per-page navigation / wait timeout (ms). Defaults to 60s. */
  pageTimeoutMs?: number;
  /** Overall driver timeout (ms). Defaults to 3 minutes — matches YAML. */
  timeoutMs?: number;
  /** Resolver for demos-by-slug. Defaults to reading /app/data/registry.json. */
  demosResolver?: DemosResolver;
  /**
   * After `waitForSelector` succeeds, poll `textContent` until non-empty
   * for up to this many ms. CopilotKit renders the assistant-message
   * container before tokens stream in (`""` initially); slower
   * integrations (ms-agent-dotnet: extra network hop) need time for the
   * first token to arrive. Defaults to `pageTimeoutMs`.
   */
  textPollTimeoutMs?: number;
  /**
   * Factory for the per-`run()` correlation id (`runId`) folded into the
   * aimock X-Test-Id (`d4-<slug>-<runId>`). Defaults to `mintRunId`
   * (`crypto.randomUUID()`). Injectable ONLY so unit tests can supply a
   * deterministic counter and assert the per-run-unique X-Test-Id without
   * matching a brittle UUID regex. Production always uses the default. The id
   * is minted once per `run()`, so both L3/L4 levels of one run share it
   * (stable within a run) and it is unique across runs — eliminating the
   * cross-run aimock fixture-match-count desync that flapped the dashboard.
   */
  idFactory?: () => string;
  /**
   * CVDIAG flap-observability emitter (L1-A, spec §3 Layer 1). When provided,
   * the driver emits the 12 probe-layer boundaries through it (gated by the
   * emitter's resolved verbosity tier). Injectable so unit tests can supply an
   * emitter with a captured PB-writer seam and assert the emitted envelopes
   * without a live PB. When ABSENT, the driver constructs one from `ctx.env`
   * on first use (so production wiring needs no extra plumbing). CVDIAG is pure
   * instrumentation — a missing or failing emitter NEVER changes the probe's
   * red/green outcome.
   */
  cvdiagEmitter?: CvdiagEmitter;
  /**
   * Root directory for the per-test replay-fallback ndjson buffer
   * (`<dir>/<date>/<test-id>.ndjson`, spec §4 / §1.5). Defaults to
   * `~/.cvdiag/buffer`. Injectable so tests buffer into a tmpdir. Buffering is
   * best-effort: a write failure is swallowed and never breaks a probe.
   */
  cvdiagBufferDir?: string;
}

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
 * `sequence_num` join that detects dropped/reordered frontend events. Because
 * `probe.exit` is terminal (the future is unknown at emit time), the driver
 * buffers the last `CVDIAG_PRE_TIMEOUT_WINDOW_MS` of SSE events and flushes the
 * full unsampled set on a timeout exit.
 */
const CVDIAG_PRE_TIMEOUT_WINDOW_MS = 5_000;
/** `probe.console.error.message_scrubbed` byte cap (spec §5). */
const CVDIAG_CONSOLE_MSG_CAP_BYTES = 512;
/** `probe.navigate.complete.url` byte cap (spec §5). */
const CVDIAG_URL_CAP_BYTES = 256;

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_PAGE_TIMEOUT_MS = 60 * 1000;

/** A single buffered SSE event awaiting sample/carve-out decision. */
interface PendingSseEvent {
  eventType: string;
  payloadSizeBytes: number;
  /** Wall-clock ms when observed (for the pre-timeout carve-out window). */
  atMs: number;
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
class CvdiagProbeSession {
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
    this.testId = opts.testId;
    this.slug = opts.slug;
    this.demo = opts.demo;
    this.bufferDir = opts.bufferDir;
    this.startMonoMs = opts.nowMs;
    this.sseWindowStartMs = opts.nowMs;
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
  private async buffer(env: CvdiagEnvelope): Promise<void> {
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
    this.pendingSse.push({
      eventType: evt.eventType,
      payloadSizeBytes: evt.payloadSizeBytes,
      atMs: nowMs,
    });
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
      this.emitSse(evt.eventType, evt.payloadSizeBytes);
    }
  }

  private emitSse(eventType: string, payloadSizeBytes: number): void {
    const seq = this.nextSeq("sse");
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
   */
  exit(terminalOutcome: CvdiagOutcome, totalDurationMs: number): void {
    if (terminalOutcome === "timeout") {
      for (const ev of this.pendingSse) {
        this.emitSse(ev.eventType, ev.payloadSizeBytes);
      }
      this.pendingSse.length = 0;
    }
    this.fire({
      boundary: "probe.exit",
      outcome: terminalOutcome,
      durationMs: totalDurationMs,
      metadata: {
        terminal_outcome: terminalOutcome,
        total_duration_ms: totalDurationMs,
        sse_event_count: this.sseEmittedCount,
        first_token_delta_ms: this.firstTokenDeltaMs,
      },
    });
  }
}

/** Default replay-fallback ndjson buffer root (spec §4 `~/.cvdiag/buffer`). */
function defaultCvdiagBufferDir(): string {
  return path.join(os.homedir(), ".cvdiag", "buffer");
}

/**
 * Monotonic wall-clock ms for CVDIAG delta computations
 * (`delta_ms_from_start`, the SSE sampling window, the pre-timeout carve-out).
 * `performance.now()` is monotonic and immune to wall-clock skew — the right
 * source for intra-probe durations.
 */
function nowMonoMs(): number {
  return performance.now();
}

/**
 * Weather vocabulary the L4 response must include — mirrors the
 * `hasWeatherContent` check in showcase/tests/e2e/integration-smoke.spec.ts.
 * Keeping the list in one place so future vocabulary additions land in
 * exactly one spot; the unit test exercises the exact items below.
 */
const WEATHER_VOCAB = [
  "san francisco",
  "weather",
  "temperature",
  "degrees",
  "sunny",
  "cloudy",
  "rain",
  "humidity",
  "wind",
];

/**
 * The slice of Playwright's `Page` the launcher adapter consumes. Declared
 * structurally (not imported) so the module stays loadable without the
 * `playwright` type tree at module scope — mirroring the existing `E2ePage`
 * decoupling rationale. The CVDIAG seams (`page.on(...)`) read response /
 * requestfailed / console events; the CDP-backed SSE interceptor
 * (`helpers/sse-interceptor.ts`) is the production source for SSE events and
 * is wired by a higher layer when present.
 */
interface PlaywrightPageLike {
  goto(url: string, opts?: unknown): Promise<unknown>;
  type(selector: string, text: string, opts?: unknown): Promise<void>;
  press(selector: string, key: string, opts?: unknown): Promise<void>;
  waitForSelector(selector: string, opts?: unknown): Promise<unknown>;
  textContent(selector: string): Promise<string | null>;
  evaluate<R>(fn: () => R): Promise<R>;
  close(): Promise<void>;
  on(event: string, handler: (arg: unknown) => void): void;
}

/**
 * Adapt a concrete Playwright `Page` onto our `E2ePage`, wiring the CVDIAG
 * event-source seams to Playwright's `page.on("response" | "requestfailed" |
 * "console")`. Shared by both the default and pooled launchers so the seam
 * wiring lives in exactly one place. The SSE seams (`onSseEvent` /
 * `onSseAborted`) are intentionally NOT wired here: production SSE capture
 * runs through the CDP-backed interceptor (`helpers/sse-interceptor.ts`),
 * which a higher layer attaches; leaving them unwired here means the driver
 * simply emits no `probe.sse.event` rows from the network listener (correct —
 * Playwright's `page.on` has no per-SSE-event signal).
 */
function wirePlaywrightPage(page: PlaywrightPageLike): E2ePage {
  // Per-request issue-time tracking so `probe.network.response.duration_ms`
  // reflects the request→response wall-clock, not just the response event.
  const requestStartByUrl = new Map<string, number>();
  return {
    goto: (url, opts) => page.goto(url, opts),
    type: (sel, text, opts) => page.type(sel, text, opts),
    press: (sel, key, opts) => page.press(sel, key, opts),
    waitForSelector: (sel, opts) => page.waitForSelector(sel, opts),
    textContent: (sel) => page.textContent(sel),
    evaluate: <R>(fn: () => R) => page.evaluate(fn),
    close: () => page.close(),
    onResponse(handler) {
      page.on("response", (arg) => {
        const resp = arg as {
          url(): string;
          status(): number;
          headers(): Record<string, string>;
          request(): { method(): string };
        };
        try {
          const url = resp.url();
          const headers = resp.headers();
          const clHeader = headers["content-length"];
          const contentLength =
            clHeader !== undefined && clHeader !== ""
              ? Number.parseInt(clHeader, 10)
              : null;
          const startedAt = requestStartByUrl.get(url);
          const durationMs =
            startedAt !== undefined ? Math.round(nowMonoMs() - startedAt) : 0;
          requestStartByUrl.delete(url);
          handler({
            url,
            status: resp.status(),
            headers,
            contentLength:
              contentLength !== null && Number.isNaN(contentLength)
                ? null
                : contentLength,
            durationMs,
            isMessagePost: resp.request().method() === "POST",
          });
        } catch {
          /* never throw out of an event listener */
        }
      });
      page.on("request", (arg) => {
        try {
          const req = arg as { url(): string };
          requestStartByUrl.set(req.url(), nowMonoMs());
        } catch {
          /* ignore */
        }
      });
    },
    onRequestFailed(handler) {
      page.on("requestfailed", (arg) => {
        try {
          const req = arg as {
            url(): string;
            failure(): { errorText: string } | null;
            response(): { status(): number } | null;
          };
          const resp = req.response?.();
          handler({
            url: req.url(),
            errorClass: req.failure()?.errorText ?? "unknown",
            responseStatus: resp ? resp.status() : null,
          });
        } catch {
          /* ignore */
        }
      });
    },
    onConsole(handler) {
      page.on("console", (arg) => {
        try {
          const msg = arg as {
            type(): string;
            text(): string;
            location(): {
              url?: string;
              lineNumber?: number;
              columnNumber?: number;
            };
          };
          const t = msg.type();
          if (t !== "error" && t !== "warning") return;
          const loc = msg.location();
          handler({
            level: t,
            text: msg.text(),
            sourceFile: loc?.url ?? null,
            lineCol:
              loc?.lineNumber !== undefined
                ? `${loc.lineNumber}:${loc.columnNumber ?? 0}`
                : null,
          });
        } catch {
          /* ignore */
        }
      });
    },
  };
}

/**
 * Default launcher — dynamic import of `playwright` keeps the driver
 * module loadable in environments without chromium installed. Throws
 * an instructive error if the dependency tree is misconfigured; the
 * driver's outer try/catch surfaces the throw as a red ProbeResult with
 * `errorDesc: "launcher-error"` so operators see a specific, keyed
 * alert on the next tick.
 */
const defaultLauncher: E2eBrowserLauncher = async (): Promise<E2eBrowser> => {
  // Using a function-level dynamic import so unit tests that never invoke
  // the default launcher never touch the `playwright` package at all.
  const mod = (await import("playwright")) as typeof import("playwright");
  const browser = await mod.chromium.launch({
    headless: true,
    // Railway's container networking drops the default `--disable-dev-shm-usage`
    // assumption; passing it explicitly avoids /dev/shm exhaustion on tiny
    // replicas. Matches the GH-Actions smoke runner args.
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  // Adapt the concrete Playwright API surface onto our minimal interface
  // so tests can swap in fakes without importing playwright's types.
  return {
    async newContext(ctxOpts?: {
      extraHTTPHeaders?: Record<string, string>;
    }): Promise<E2eBrowserContext> {
      const ctx = await browser.newContext({
        extraHTTPHeaders: {
          "X-AIMock-Strict": "true",
          ...ctxOpts?.extraHTTPHeaders,
        },
      });
      return {
        async newPage(): Promise<E2ePage> {
          const page = await ctx.newPage();
          return wirePlaywrightPage(page as unknown as PlaywrightPageLike);
        },
        close: () => ctx.close(),
      };
    },
    close: () => browser.close(),
  };
};

export function createPooledE2eSmokeLauncher(
  pool: BrowserPool,
  logger?: { warn(event: string, meta?: Record<string, unknown>): void },
): E2eBrowserLauncher {
  return async (abortSignal?: AbortSignal): Promise<E2eBrowser> => {
    // CONTEXT-POOLED model: the launcher no longer acquires a Browser. Each
    // `newContext()` checks out a pooled BrowserContext on a shared long-lived
    // browser process (`pool.acquire`), and the wrapper's `close()` returns it
    // (`pool.release`). The pool centralizes the X-AIMock-Strict default header;
    // per-probe headers (X-AIMock-Context, X-Test-Id) flow through `ctxOpts`.
    // The abort closure re-targets onto the open contexts: on abort it closes
    // each (each close() releases its pooled context). Without this listener
    // those contexts stay in-use across probe ticks when the invoker's
    // Promise.race abandons the driver on hard-timeout / external abort,
    // saturating the pool and starving later ticks.
    let aborted = false;

    // Track open contexts so abort can close them. Each close() releases the
    // pooled context back to the pool, freeing a context slot.
    const openContexts = new Set<{ close(): Promise<void> }>();

    const onAbort = (): void => {
      if (aborted) return;
      aborted = true;
      const ctxCount = openContexts.size;
      const stats = pool.stats();
      logger?.warn("probe.e2e-smoke.pool-abort-release", {
        openContexts: ctxCount,
        poolAvailable: stats.available,
        poolInUse: stats.inUse,
        poolSize: stats.size,
      });
      const contextClosePromises = Array.from(openContexts).map((ctx) =>
        ctx.close().catch(() => {}),
      );
      void Promise.allSettled(contextClosePromises).then(() => {
        logger?.warn("probe.e2e-smoke.pool-abort-released", {
          closedContexts: ctxCount,
          poolAvailable: pool.stats().available,
        });
      });
    };
    // Capture the listener so launcher-level close() can detach it: without
    // removeEventListener a post-completion abort would fire onAbort after the
    // run returned (closing nothing, but leaking the listener for the signal's
    // lifetime).
    let detachAbort: (() => void) | undefined;
    if (abortSignal) {
      if (abortSignal.aborted) {
        aborted = true;
        logger?.warn("probe.e2e-smoke.pool-pre-aborted-release");
      } else {
        abortSignal.addEventListener("abort", onAbort, { once: true });
        detachAbort = () => abortSignal.removeEventListener("abort", onAbort);
      }
    }

    return {
      async newContext(ctxOpts?: {
        extraHTTPHeaders?: Record<string, string>;
      }): Promise<E2eBrowserContext> {
        const ctx = await pool.acquire({
          extraHTTPHeaders: ctxOpts?.extraHTTPHeaders,
        });
        // If the signal was already aborted at launcher construction (the
        // pre-aborted branch never attached the live abort listener), a context
        // opened now would never be closed by the abort path. Release it
        // immediately and refuse so it cannot leak into a torn-down run.
        if (aborted) {
          await pool.release(ctx).catch(() => {});
          throw new Error("e2e-smoke launcher aborted");
        }
        const ctxHandle = { close: () => pool.release(ctx) };
        openContexts.add(ctxHandle);
        return {
          async newPage(): Promise<E2ePage> {
            const page = await ctx.newPage();
            return wirePlaywrightPage(page as unknown as PlaywrightPageLike);
          },
          close: async () => {
            openContexts.delete(ctxHandle);
            await ctxHandle.close();
          },
        };
      },
      // Launcher-level close releases nothing itself — contexts are released
      // individually via each context-wrapper's close() — but it detaches the
      // abort listener so a post-completion abort can't fire onAbort after the
      // run returned. There is no Browser held to release.
      close: async () => {
        detachAbort?.();
      },
    };
  };
}

/**
 * Default demos resolver. Reads `/app/data/registry.json` once (memoised
 * in-closure) and looks up `integrations[].slug → demos[].id`. The
 * Dockerfile copies `showcase/shell/src/data/registry.json` into that
 * path; local dev can override via `REGISTRY_JSON_PATH` env. Returns `[]`
 * on missing file / parse error — a misconfigured runtime image should
 * degrade to "L3 only" rather than failing every tick outright.
 */
function createDefaultDemosResolver(): DemosResolver {
  let cache: Map<string, string[]> | null = null;
  return async (slug: string): Promise<string[]> => {
    if (cache === null) {
      const override = process.env.REGISTRY_JSON_PATH;
      const fallback = path.resolve("/app/data/registry.json");
      const registryPath = override ?? fallback;
      try {
        const raw = await fs.readFile(registryPath, "utf-8");
        const parsed = JSON.parse(raw) as {
          integrations?: Array<{
            slug?: string;
            demos?: Array<{ id?: string }>;
          }>;
        };
        const map = new Map<string, string[]>();
        for (const it of parsed.integrations ?? []) {
          if (!it.slug) continue;
          const demoIds = (it.demos ?? [])
            .map((d) => d.id)
            .filter((id): id is string => typeof id === "string");
          map.set(it.slug, demoIds);
        }
        cache = map;
      } catch {
        cache = new Map();
      }
    }
    return cache.get(slug) ?? [];
  };
}

/** Create a configured e2e-smoke driver. Exported for tests; production
 * callers use the module-level `e2eChatToolsDriver`. */
export function createE2eSmokeDriver(
  deps: E2eSmokeDriverDeps = {},
): ProbeDriver<E2eSmokeDriverInput, E2eSmokeSignal> {
  const launcher = deps.launcher ?? defaultLauncher;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pageTimeoutMs = deps.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const textPollTimeoutMs = deps.textPollTimeoutMs ?? pageTimeoutMs;
  const demosResolver = deps.demosResolver ?? createDefaultDemosResolver();
  const idFactory = deps.idFactory ?? mintRunId;
  const cvdiagBufferDir = deps.cvdiagBufferDir ?? defaultCvdiagBufferDir();

  return {
    kind: "e2e_smoke",
    inputSchema,
    async run(
      ctx: ProbeContext,
      input: E2eSmokeDriverInput,
    ): Promise<ProbeResult<E2eSmokeSignal>> {
      const observedAt = ctx.now().toISOString();
      // CVDIAG emitter (L1-A). Injected for tests; otherwise constructed from
      // the probe's env so the resolved verbosity tier (default/verbose/debug)
      // honors CVDIAG_VERBOSE / CVDIAG_DEBUG. Construction is wrapped so a
      // fail-closed DEBUG guard throw can never break the probe — CVDIAG is
      // pure instrumentation.
      let cvdiagEmitter: CvdiagEmitter | undefined = deps.cvdiagEmitter;
      if (cvdiagEmitter === undefined) {
        try {
          cvdiagEmitter = new CvdiagEmitter({ env: ctx.env, layer: "probe" });
        } catch (err) {
          ctx.logger.warn("probe.e2e-smoke.cvdiag-init-failed", {
            err: err instanceof Error ? err.message : String(err),
          });
          cvdiagEmitter = undefined;
        }
      }
      // Prefer explicit backendUrl; fall back to discovery-supplied publicUrl.
      // Schema already guaranteed at least one is present.
      const backendUrl = (input.backendUrl ?? input.publicUrl)!;
      const slug = deriveSlug(input.key, input.name);
      // Per-run correlation id folded into the aimock X-Test-Id
      // (`d4-<slug>-<runId>`). Minted once per `run()` so both L3/L4 levels
      // share it (stable within a run) yet it is unique across runs, giving
      // each run a fresh aimock per-test-id fixture-match count and removing
      // the cross-run sequence/turn-count desync that flapped the dashboard.
      const runId = idFactory();
      const shape = resolveShape(
        { name: input.name, shape: input.shape },
        { logger: ctx.logger },
      );

      // Demos resolution: (1) in-band `input.demos`, (2) registry lookup
      // via the injected resolver. A slug with no demos entry gets
      // `[]` which skips L4 — the same outcome as a service that
      // legitimately doesn't expose tool-rendering.
      let demos: string[];
      if (Array.isArray(input.demos)) {
        demos = input.demos;
      } else {
        try {
          demos = await demosResolver(slug);
        } catch (err) {
          ctx.logger.warn("probe.e2e-smoke.demos-resolve-failed", {
            slug,
            err: err instanceof Error ? err.message : String(err),
          });
          demos = [];
        }
      }
      const hasToolRendering = demos.includes("tool-rendering");

      // Arm an AbortController that combines:
      //   1. The driver's own `timeoutMs` hard cap (triggers teardown).
      //   2. The invoker-provided `ctx.abortSignal` (so a probe-level
      //      timeout in probe-invoker.ts also propagates into page.close()
      //      / browser.close()).
      const abort = new AbortController();
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, timeoutMs);
      const externalAbort = ctx.abortSignal;
      const onExternalAbort = (): void => {
        abort.abort();
      };
      if (externalAbort) {
        if (externalAbort.aborted) {
          abort.abort();
        } else {
          externalAbort.addEventListener("abort", onExternalAbort, {
            once: true,
          });
        }
      }

      let browser: E2eBrowser | undefined;
      const tearDown = async (): Promise<void> => {
        if (browser) {
          try {
            await browser.close();
          } catch (err) {
            ctx.logger.warn("probe.e2e-smoke.browser-close-failed", {
              slug,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      };

      try {
        try {
          browser = await launcher(abort.signal);
        } catch (err) {
          // If the driver's hard-timeout fired first and aborted a
          // launcher that observes the signal, surface the timeout path
          // rather than masquerading the abort as a launcher-error. The
          // user-facing distinction matters: launcher-error → chromium
          // missing; timeout → remote stack slow.
          if (timedOut) {
            throw err;
          }
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn("probe.e2e-smoke.launcher-error", { slug, err: msg });
          return {
            key: input.key,
            state: "red",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              l3: "red",
              l4: hasToolRendering ? "red" : "skipped",
              failureSummary: truncateUtf8(msg, 1200),
              errorDesc: "launcher-error",
            },
            observedAt,
          };
        }

        // L3 — chat round-trip against /demos/agentic-chat.
        const l3 = await runLevel({
          browser,
          slug,
          backendUrl,
          level: "chat",
          demo: "agentic-chat",
          demoPath: "/demos/agentic-chat",
          message: "Hello, please respond with a brief greeting.",
          testId: `d4-${slug}-${runId}`,
          abortSignal: abort.signal,
          pageTimeoutMs,
          textPollTimeoutMs,
          now: ctx.now,
          cvdiagEmitter,
          cvdiagBufferDir,
          assertResponse: (text) => ({
            ok: text.length > 0,
            summary: text.length === 0 ? "empty assistant response" : "",
          }),
        });
        if (ctx.writer) {
          try {
            await ctx.writer.write({
              key: `chat:${slug}`,
              state: l3.result.state,
              signal: l3.result.signal,
              observedAt: ctx.now().toISOString(),
            });
          } catch (err) {
            ctx.logger.error("probe.e2e-smoke.chat-writer-failed", {
              slug,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }

        let l4State: "green" | "red" | "skipped" = "skipped";
        let l4Summary = "";
        if (hasToolRendering) {
          const l4 = await runLevel({
            browser,
            slug,
            backendUrl,
            level: "tools",
            demo: "tool-rendering",
            demoPath: "/demos/tool-rendering",
            message: "What's the weather in San Francisco?",
            testId: `d4-${slug}-${runId}`,
            abortSignal: abort.signal,
            pageTimeoutMs,
            textPollTimeoutMs,
            now: ctx.now,
            cvdiagEmitter,
            cvdiagBufferDir,
            assertResponse: (text) => {
              if (text.length === 0) {
                return { ok: false, summary: "empty assistant response" };
              }
              const lc = text.toLowerCase();
              const hit = WEATHER_VOCAB.some((v) => lc.includes(v));
              return {
                ok: hit,
                summary: hit
                  ? ""
                  : `response missing weather vocabulary: ${truncateUtf8(text, 200)}`,
              };
            },
          });
          l4State = l4.result.state === "green" ? "green" : "red";
          l4Summary = l4.result.signal.failureSummary;
          if (ctx.writer) {
            try {
              await ctx.writer.write({
                key: `tools:${slug}`,
                state: l4.result.state,
                signal: l4.result.signal,
                observedAt: ctx.now().toISOString(),
              });
            } catch (err) {
              ctx.logger.error("probe.e2e-smoke.tools-writer-failed", {
                slug,
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        const l3State: "green" | "red" =
          l3.result.state === "green" ? "green" : "red";
        const aggregateGreen = l3State === "green" && l4State !== "red";
        const failureSummary = aggregateGreen
          ? ""
          : truncateUtf8(
              [
                l3State === "red"
                  ? `L3: ${l3.result.signal.failureSummary}`
                  : "",
                l4State === "red" ? `L4: ${l4Summary}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              1200,
            );

        return {
          key: input.key,
          state: aggregateGreen ? "green" : "red",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            l3: l3State,
            l4: l4State,
            failureSummary,
          },
          observedAt,
        };
      } catch (err) {
        if (timedOut) {
          ctx.logger.warn("probe.e2e-smoke.timeout", { slug, timeoutMs });
          return {
            key: input.key,
            state: "red",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              l3: "red",
              l4: hasToolRendering ? "red" : "skipped",
              failureSummary: `timeout after ${timeoutMs}ms`,
              errorDesc: "timeout",
            },
            observedAt,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("probe.e2e-smoke.driver-error", { slug, err: msg });
        return {
          key: input.key,
          state: "red",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            l3: "red",
            l4: hasToolRendering ? "red" : "skipped",
            failureSummary: truncateUtf8(msg, 1200),
            errorDesc: "driver-error",
          },
          observedAt,
        };
      } finally {
        clearTimeout(timeoutHandle);
        if (externalAbort) {
          externalAbort.removeEventListener("abort", onExternalAbort);
        }
        await tearDown();
      }
    },
  };
}

/**
 * Run one level (L3 or L4): open a fresh browser context + page, navigate,
 * send the message, read the assistant response, and apply the caller's
 * assertion. Each level owns its own context so cookies/localStorage from
 * L3 don't contaminate L4 (and vice versa). Context is always closed in
 * the finally block, even on assertion failure, so a hung L3 doesn't
 * orphan a context that would block the L4 run.
 */
async function runLevel(opts: {
  browser: E2eBrowser;
  slug: string;
  backendUrl: string;
  level: "chat" | "tools";
  /** Closed-enum demo id (`agentic-chat` | `tool-rendering`) for CVDIAG. */
  demo: string;
  demoPath: string;
  message: string;
  /** Per-run aimock X-Test-Id (`d4-<slug>-<runId>`), shared by L3/L4. */
  testId: string;
  abortSignal: AbortSignal;
  pageTimeoutMs: number;
  textPollTimeoutMs: number;
  now: () => Date;
  /** CVDIAG emitter (L1-A); absent → no CVDIAG emission (instrumentation off). */
  cvdiagEmitter?: CvdiagEmitter;
  /** Replay-fallback ndjson buffer root for this level's CVDIAG session. */
  cvdiagBufferDir?: string;
  assertResponse: (text: string) => { ok: boolean; summary: string };
}): Promise<{ result: ProbeResult<E2eSmokeLevelSignal> }> {
  const {
    browser,
    slug,
    backendUrl,
    level,
    demo,
    demoPath,
    message,
    testId,
    abortSignal,
    pageTimeoutMs,
    textPollTimeoutMs,
    now,
    cvdiagEmitter,
    cvdiagBufferDir,
    assertResponse,
  } = opts;

  // CVDIAG session for THIS level (one test_id). The probe-layer test_id is
  // the per-level X-Test-Id so harness↔backend↔aimock correlate on the same
  // key. The CvdiagEmitter normalizes/validates; if the X-Test-Id is not a
  // UUIDv7 the emitter mints one rather than emitting an invalid envelope.
  const cvdiag =
    cvdiagEmitter !== undefined
      ? new CvdiagProbeSession({
          emitter: cvdiagEmitter,
          testId,
          slug,
          demo,
          bufferDir: cvdiagBufferDir ?? defaultCvdiagBufferDir(),
          nowMs: nowMonoMs(),
        })
      : undefined;

  if (abortSignal.aborted) {
    // Surface as red so the aggregate bookkeeping still reads "ran".
    return {
      result: {
        key: `${level}:${slug}`,
        state: "red",
        signal: {
          slug,
          backendUrl,
          level,
          failureSummary: "aborted before start",
          errorDesc: "abort",
        },
        observedAt: now().toISOString(),
      },
    };
  }

  let context: E2eBrowserContext | undefined;
  let page: E2ePage | undefined;
  // CVDIAG terminal-outcome tracking. `timeout` is inferred from an aborted
  // signal at the point the level errors; `err` from any other throw; `ok`
  // from a clean completion. The exit boundary is emitted exactly once in the
  // finally block so it fires on every path (clean, throw, abort).
  const cvdiagStartMs = nowMonoMs();
  let cvdiagExited = false;
  let cvdiagResponseEmpty = true;
  /** Capture the agent-message POST edge headers for `probe.message.send`. */
  let messageSendEdge: ReturnType<typeof filterEdgeHeaders> | undefined;
  try {
    context = await browser.newContext({
      extraHTTPHeaders: {
        "X-AIMock-Context": slug,
        "X-Test-Id": testId,
      },
    });
    page = await context.newPage();

    // ── CVDIAG event-source wiring (best-effort) ────────────────────────────
    // Register handlers for the network/console/SSE seams the real launcher
    // wires to Playwright. A fake page that doesn't model a seam simply never
    // invokes the handler — no CVDIAG row for that boundary, no probe impact.
    if (cvdiag && page) {
      const p = page;
      p.onResponse?.((resp) => {
        cvdiag.networkResponse(resp);
        if (resp.isMessagePost) {
          messageSendEdge = filterEdgeHeaders(resp.headers);
        }
      });
      p.onRequestFailed?.((req) => cvdiag.networkError(req));
      p.onConsole?.((c) => cvdiag.consoleError(c));
      p.onSseEvent?.((e) => {
        // First non-empty SSE event also marks first-token timing when the DOM
        // first-token has not yet been observed — but DOM first-token is the
        // authoritative class-(d/e) discriminator, so SSE only feeds the
        // `probe.sse.event` stream here. firsttoken is emitted from the DOM
        // poll below.
        cvdiag.sseEvent(e, nowMonoMs());
      });
      p.onSseAborted?.((e) => cvdiag.sseAborted(e));
    }

    // probe.start — mint/thread the test_id and record entry (spec §3).
    cvdiag?.start(`${backendUrl}${demoPath}`, { width: 1280, height: 720 });

    const url = `${backendUrl}${demoPath}`;
    // Use `waitUntil: "load"` (NOT "networkidle") to mirror the d5/d6
    // drivers (d6-all-pills.ts). CopilotKit demo pages hold a persistent
    // agent SSE stream, so "networkidle" never settles and D4 times out.
    // Readiness is asserted explicitly below by waiting for the chat
    // <textarea> selector — that wait, not network quiescence, is what
    // guarantees the page is interactive.
    const navStartMs = nowMonoMs();
    const navResp = (await page.goto(url, {
      waitUntil: "load",
      timeout: pageTimeoutMs,
    })) as { status?: () => number } | null;
    // probe.navigate.complete — nav timing + HTTP status (when the launcher
    // surfaces a Response handle from goto; fakes return undefined → null).
    const navStatus =
      navResp && typeof navResp.status === "function" ? navResp.status() : null;
    cvdiag?.navigateComplete(
      url,
      Math.round(nowMonoMs() - navStartMs),
      navStatus,
    );

    // Wait for the chat textarea, type, and submit. Selector mirrors the
    // reference helper (showcase/tests/e2e/helpers.ts) — CopilotKit
    // renders a single <textarea> for the chat input.
    await page.waitForSelector("textarea", {
      state: "visible",
      timeout: pageTimeoutMs,
    });
    await page.type("textarea", message, { timeout: pageTimeoutMs });
    await page.press("textarea", "Enter", { timeout: pageTimeoutMs });

    // probe.message.send — the agent-message POST has been issued. Edge headers
    // are captured from the message-POST response observed on the `onResponse`
    // seam (set above); absent → all-null edge headers.
    cvdiag?.messageSend(0, message.length, messageSendEdge);

    // Wait for an assistant message to appear. The helper's testid
    // convention is `[data-testid="copilot-assistant-message"]`; some
    // showcases don't set the testid, so we fall back to scraping the
    // <body> for substantive text that appeared after our message.
    let responseText = "";
    try {
      await page.waitForSelector('[data-testid="copilot-assistant-message"]', {
        state: "visible",
        timeout: pageTimeoutMs,
      });
      // probe.dom.container.mount — assistant-message container is visible.
      cvdiag?.containerMount(nowMonoMs());
      // CopilotKit renders the assistant-message container before tokens
      // stream in (starts as ""). Slower integrations (ms-agent-dotnet:
      // extra network hop) need time for the first token to arrive. Poll
      // for non-empty textContent instead of reading once.
      //
      // IMPORTANT: we use `page.evaluate()` instead of
      // `page.textContent(selector)` for two reasons:
      //
      //   1. CSS `:last-of-type` is unreliable here. CopilotKit often
      //      renders a trailing <div> (streaming indicator, input area)
      //      after the assistant-message <div>. `:last-of-type` selects
      //      the last element of a given TAG TYPE among siblings, so it
      //      matches the trailing <div> — not the assistant message.
      //      The compound selector
      //      `[data-testid="copilot-assistant-message"]:last-of-type`
      //      then matches ZERO elements.
      //
      //   2. Playwright's `page.textContent(selector)` auto-waits up to
      //      30 s for the selector to match. When the selector matches
      //      nothing (see #1), each poll iteration blocks for 30 s and
      //      then throws — making the 500 ms poll interval meaningless.
      //      Two failed polls exhaust the entire textPollTimeoutMs
      //      budget, and the outer catch swallows the timeout, returning
      //      empty text → false-red.
      //
      // `page.evaluate()` runs synchronously in the browser context,
      // returns immediately with whatever the DOM currently holds, and
      // uses `querySelectorAll` to find the last matching element by
      // index rather than by CSS pseudo-selector.
      let raw = "";
      const pollEnd = Date.now() + textPollTimeoutMs;
      while (Date.now() < pollEnd) {
        // The callback executes in the browser where `document` exists.
        // TypeScript's Node-only `lib` doesn't include DOM types, so we
        // access `document` via `globalThis` to avoid a compile error
        // without polluting the project-wide tsconfig with `"dom"`.
        raw =
          (await page.evaluate(() => {
            // `document` lives in the browser context where this callback
            // runs. The server-side tsconfig intentionally excludes DOM
            // types, so we reach it via a type-erased indirection.
            const win = globalThis as unknown as {
              document: {
                querySelectorAll(
                  sel: string,
                ): ArrayLike<{ textContent: string | null }>;
              };
            };
            const msgs = win.document.querySelectorAll(
              '[data-testid="copilot-assistant-message"]',
            );
            if (msgs.length === 0) return "";
            return msgs[msgs.length - 1]!.textContent ?? "";
          })) ?? "";
        if (raw.trim().length > 0) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      responseText = raw.trim();
      if (responseText.length > 0) {
        cvdiagResponseEmpty = false;
        // probe.dom.firsttoken — first non-empty assistant textContent.
        cvdiag?.firstToken(nowMonoMs(), responseText.length);
      }
    } catch {
      // Fallback: pull <body> text and slice off everything up to and
      // including our sent message. Mirrors helpers.ts's fallback.
      const body = (await page.textContent("body")) ?? "";
      const idx = body.lastIndexOf(message);
      if (idx >= 0) {
        const tail = body
          .slice(idx + message.length)
          .replace(/Regenerate response/g, "")
          .replace(/Copy to clipboard/g, "")
          .replace(/Thumbs (up|down)/g, "")
          .replace(/Powered by CopilotKit/g, "")
          .replace(/Type a message\.\.\./g, "")
          .trim();
        if (tail.length > 20) {
          responseText = tail.split("\n")[0]!.trim();
        }
      }
      if (responseText.length > 0) {
        cvdiagResponseEmpty = false;
        cvdiag?.firstToken(nowMonoMs(), responseText.length);
      }
    }

    // probe.dom.alternate_content — on a clean exit whose assistant text is
    // still empty (the d4 flap surface, class (d)): snapshot the child-element
    // type histogram of the assistant-message container so a markdown widget /
    // tool-result chip / code-block-only render is distinguishable from a
    // genuinely empty stream.
    if (cvdiag && cvdiagResponseEmpty && page) {
      const histogram = await readAlternateContentHistogram(page);
      cvdiag.alternateContent(histogram);

      // CVDIAG L2-C raw-byte capture hook (filled by L2-C): a 200-but-empty
      // SSE response is the canonical raw-byte-capture trigger. L2-C takes
      // THIS file's final state as its base and inserts its DEBUG-tier
      // decode→scrub→html-strip→head+tail≤16KB pipeline here. L1-A does NOT
      // implement raw-byte capture.
    }

    const assertion = assertResponse(responseText);
    // probe.exit (ok path) — a clean completion regardless of the assertion
    // verdict (red on a missing-vocab/empty response is still a clean run; the
    // terminal_outcome reflects probe MECHANICS, not the green/red assertion).
    cvdiagExit(cvdiag, "ok");
    cvdiagExited = true;
    return {
      result: {
        key: `${level}:${slug}`,
        state: assertion.ok ? "green" : "red",
        signal: {
          slug,
          backendUrl,
          level,
          responseText: responseText || undefined,
          failureSummary: assertion.ok ? "" : assertion.summary,
        },
        observedAt: now().toISOString(),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // probe.exit (error path) — `timeout` when the level aborted (the driver's
    // hard-timeout / external abort fired), else `err`.
    cvdiagExit(cvdiag, abortSignal.aborted ? "timeout" : "err");
    cvdiagExited = true;
    return {
      result: {
        key: `${level}:${slug}`,
        state: "red",
        signal: {
          slug,
          backendUrl,
          level,
          failureSummary: truncateUtf8(msg, 1200),
          errorDesc: abortSignal.aborted ? "abort" : "level-error",
        },
        observedAt: now().toISOString(),
      },
    };
  } finally {
    // Defense in depth: if neither the ok nor the error path emitted exit (an
    // unexpected control-flow gap), emit it here so `probe.exit` fires exactly
    // once on every path.
    if (!cvdiagExited) cvdiagExit(cvdiag, "err");
    if (page) {
      try {
        await page.close();
      } catch {
        /* swallow — context.close() still cleans up. */
      }
    }
    if (context) {
      try {
        await context.close();
      } catch {
        /* swallow — browser.close() in outer finally catches remnants. */
      }
    }
  }

  /** Emit `probe.exit` with the total level duration (best-effort). */
  function cvdiagExit(
    session: CvdiagProbeSession | undefined,
    outcome: CvdiagOutcome,
  ): void {
    session?.exit(outcome, Math.round(nowMonoMs() - cvdiagStartMs));
  }
}

/**
 * Read the child-element type histogram of the LAST assistant-message
 * container (spec §5 `probe.dom.alternate_content.child_type_histogram`).
 * Runs in the browser context via `evaluate`; returns `{}` on any read fault
 * so a histogram read can never break the probe. Tag names are lowercased;
 * a tool-result chip / markdown widget / code block surfaces as its element
 * tag (e.g. `pre`, `code`, `div`).
 */
async function readAlternateContentHistogram(
  page: E2ePage,
): Promise<Record<string, number>> {
  try {
    return (
      (await page.evaluate(() => {
        const win = globalThis as unknown as {
          document: {
            querySelectorAll(sel: string): ArrayLike<{
              children: ArrayLike<{ tagName: string }>;
            }>;
          };
        };
        const msgs = win.document.querySelectorAll(
          '[data-testid="copilot-assistant-message"]',
        );
        const hist: Record<string, number> = {};
        if (msgs.length === 0) return hist;
        const last = msgs[msgs.length - 1]!;
        for (let i = 0; i < last.children.length; i++) {
          const tag = last.children[i]!.tagName.toLowerCase();
          hist[tag] = (hist[tag] ?? 0) + 1;
        }
        return hist;
      })) ?? {}
    );
  } catch {
    return {};
  }
}

/**
 * Extract the slug used for side-emit keys and registry lookup. Preference:
 *   1. Everything after `:` in `input.key` (matches the YAML dedupe key).
 *   2. Railway service `name` with the `showcase-` prefix stripped (the
 *      name-based form when the YAML key-template doesn't yet carry the
 *      slug cleanly).
 *   3. The whole key as-is (fallback).
 */
function deriveSlug(key: string, name?: string): string {
  const parts = key.split(":");
  let raw: string;
  if (parts.length >= 2 && parts[1]!.length > 0) {
    raw = parts.slice(1).join(":");
  } else if (name) {
    raw = name;
  } else {
    raw = key;
  }
  // Strip the `showcase-` prefix when present so the slug lines up with
  // registry.json's `integrations[].slug` keys (which are bare —
  // "langgraph-python", not "showcase-langgraph-python").
  return raw.startsWith("showcase-") ? raw.slice("showcase-".length) : raw;
}

/** Default driver instance with the real Playwright launcher. Registered
 * by the orchestrator at boot. */
export const e2eChatToolsDriver = createE2eSmokeDriver();
