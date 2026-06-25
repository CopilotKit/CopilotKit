import { promises as fs } from "node:fs";
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
import { CvdiagEmitter, filterEdgeHeaders } from "../../cvdiag/index.js";
import type {
  CvdiagFailureClassifier,
  CvdiagOutcome,
} from "../../cvdiag/index.js";
import {
  CvdiagProbeSession,
  defaultCvdiagBufferDir,
  nowMonoMs,
  turnCompleteReason,
} from "../../cvdiag/probe-session.js";
import type {
  CvdiagConsoleEvent,
  CvdiagRequestFailedEvent,
  CvdiagResponseEvent,
  CvdiagSseAbortedEvent,
  CvdiagSseEvent,
} from "../../cvdiag/probe-session.js";
import {
  captureRawBytes,
  parseDebugAllowList,
} from "../../cvdiag/raw-byte-capture.js";
import type { CvdiagPbWriter } from "../../cvdiag/pb-writer.js";
import {
  signAbRequest,
  verifyAbRequest,
  sanitizeTestId,
} from "../../cvdiag/ab-hmac.js";
import type { AbOutcomeRecord } from "../../cvdiag/ab-report.js";
import { mintSpanId as mintAbPairId, mintTestId } from "../../cvdiag/emit.js";

// Re-export the shared `CvdiagProbeSession` so existing importers (the d4
// tests) keep resolving it from `./d4-chat-roundtrip.js`. The class now lives
// in `../../cvdiag/probe-session.js` (shared with the d5/d6 probe path).
export { CvdiagProbeSession } from "../../cvdiag/probe-session.js";

// Re-export the shared CVDIAG event-source shapes so existing importers
// (this driver's `E2ePage` seams, the d4 tests) keep resolving them from
// `./d4-chat-roundtrip.js`. The definitions now live in
// `../../cvdiag/probe-session.js` (shared with the d5/d6 probe path).
export type {
  CvdiagConsoleEvent,
  CvdiagRequestFailedEvent,
  CvdiagResponseEvent,
  CvdiagSseAbortedEvent,
  CvdiagSseEvent,
} from "../../cvdiag/probe-session.js";

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

// The normalized CVDIAG event-source shapes (`CvdiagResponseEvent`,
// `CvdiagRequestFailedEvent`, `CvdiagConsoleEvent`, `CvdiagSseEvent`,
// `CvdiagSseAbortedEvent`) and the `CvdiagProbeSession` they feed now live in
// the shared `../../cvdiag/probe-session.js` module so the d5/d6 probe path
// (`d6-all-pills`) can construct the SAME session. They are re-exported below
// (`export type { ... }`) so existing importers (this driver's page surface,
// the d4 tests) keep resolving them from `./d4-chat-roundtrip.js` unchanged.

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
  /**
   * DEBUG-tier raw-byte sample writer (L2-C / Phase 2.5). When provided AND
   * the resolved CVDIAG tier is `debug`, a 200-but-empty SSE response triggers
   * a decode→scrub→html-strip→head+tail capture written through this writer's
   * CREATE-only `writeRawByteSample()`. Absent (the default) → no raw-byte
   * capture, which is the correct behaviour for every non-DEBUG run.
   */
  cvdiagPbWriter?: CvdiagPbWriter;
  /**
   * CVDIAG Railway-internal routing A/B (spec Phase 8): collector the A/B arm
   * outcomes flow into. Present ONLY when the A/B is wired (the future
   * `cvdiag --ab-report` path consumes the collected records). When absent (the
   * default), no A/B records are produced even if `CVDIAG_AB_INTERNAL_URL` is
   * set — the collector is the explicit opt-in seam.
   */
  abCollector?: AbOutcomeCollector;
  /**
   * IPv4-reachability check for the A/B internal target. Defaults to a
   * lightweight fetch with a 2s timeout; injectable so unit tests assert the
   * graceful-skip path without touching the network.
   */
  abReachabilityCheck?: AbReachabilityCheck;
}

/**
 * Hard cap on outstanding (un-responded) request-start timestamps tracked per
 * URL by `wirePlaywrightPage`'s FIFO timing queue. A pooled page is long-lived
 * and a CopilotKit demo holds a PERSISTENT agent SSE stream that never returns
 * a `response` event — so without a bound the per-URL queue grows unbounded
 * (memory leak) AND a much-later same-URL response shifts an ancient stale
 * start, inflating `duration_ms`. Evicting on `requestfailed`/abort handles the
 * known terminal seam; this cap is the backstop for requests that neither
 * respond nor fail (e.g. a still-open SSE stream): once a URL accumulates more
 * than this many outstanding starts, the OLDEST is dropped so the queue stays
 * bounded and a response pairs with a recent (not ancient) start.
 */
const CVDIAG_MAX_OUTSTANDING_STARTS_PER_URL = 64;

/**
 * CopilotKit runtime base path. Every showcase demo mounts its runtime under
 * this catch-all (`CopilotKitProvider runtimeUrl="/api/copilotkit"`,
 * `basePath:"/api/copilotkit"`), and the agent-message round-trip POSTs there
 * (bare `/api/copilotkit` or the per-agent run path
 * `/api/copilotkit/agent/<id>/run`). It is the ONLY route under this segment.
 */
const CVDIAG_COPILOTKIT_RUNTIME_SEGMENT = "/api/copilotkit";

/**
 * True iff a network response is the AGENT-MESSAGE POST that drives the chat
 * round-trip — i.e. a POST whose URL path is under the CopilotKit runtime
 * (`/api/copilotkit…`). Gating on the runtime path (not "any POST") is the
 * whole point: a page commonly issues OTHER POSTs (telemetry/analytics, RUM
 * beacons, asset uploads) around the agent message, and matching ANY POST let
 * the LAST such POST overwrite `messageSendEdge` / `lastMessagePostResp` — so
 * `probe.message.send`'s edge headers, the A/B `edge_interference_signal`, and
 * DEBUG raw-byte capture could be silently attributed to an UNRELATED response.
 * The path check pins capture to the actual agent-message POST. (Path is
 * matched case-insensitively against the URL string; the runtime segment is
 * distinctive enough that a substring test is unambiguous.)
 */
function isAgentMessagePost(method: string, url: string): boolean {
  return (
    method.toUpperCase() === "POST" &&
    url.toLowerCase().includes(CVDIAG_COPILOTKIT_RUNTIME_SEGMENT)
  );
}

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_PAGE_TIMEOUT_MS = 60 * 1000;

// `PendingSseEvent`, `CvdiagProbeSession`, `defaultCvdiagBufferDir`, and
// `nowMonoMs` were extracted to `../../cvdiag/probe-session.js` so the d5/d6
// probe path can reuse the SAME probe-layer session. They are imported at the
// top of this file; behavior here is unchanged.

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
export function wirePlaywrightPage(page: PlaywrightPageLike): E2ePage {
  // Per-request issue-time tracking so `probe.network.response.duration_ms`
  // reflects the request→response wall-clock, not just the response event.
  //
  // Keyed by URL → a FIFO QUEUE of issue times (not a single scalar). A bare
  // `Map<url, number>` overwrote the start time when the same URL was POSTed
  // again before its first response arrived (repeated/concurrent same-URL
  // POSTs — the norm for the agent-message endpoint), and the FIRST response
  // then deleted the entry, leaving every later same-URL response with
  // `duration_ms = 0`. A per-URL FIFO pairs each response with the OLDEST
  // outstanding request for that URL, so every request/response pair gets its
  // own duration. (HTTP/1.1 keep-alive is request-ordered per connection, and
  // even with multiplexing the FIFO pairing keeps durations bounded and
  // non-zero rather than colliding to 0.)
  const requestStartsByUrl = new Map<string, number[]>();
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
          body?(): Promise<Buffer>;
        };
        try {
          const url = resp.url();
          const headers = resp.headers();
          const clHeader = headers["content-length"];
          const contentLength =
            clHeader !== undefined && clHeader !== ""
              ? Number.parseInt(clHeader, 10)
              : null;
          // FIFO-pair this response with the OLDEST outstanding request for
          // the same URL so repeated/concurrent same-URL POSTs each keep their
          // own duration (see `requestStartsByUrl` rationale above).
          const queue = requestStartsByUrl.get(url);
          const startedAt = queue !== undefined ? queue.shift() : undefined;
          if (queue !== undefined && queue.length === 0) {
            requestStartsByUrl.delete(url);
          }
          const durationMs =
            startedAt !== undefined ? Math.round(nowMonoMs() - startedAt) : 0;
          handler({
            url,
            status: resp.status(),
            headers,
            contentLength:
              contentLength !== null && Number.isNaN(contentLength)
                ? null
                : contentLength,
            durationMs,
            // Gate on the CopilotKit runtime PATH, not "any POST": the page
            // issues unrelated POSTs (telemetry/analytics/beacons) around the
            // agent message, and matching any POST let the LAST one overwrite
            // the captured agent-message response. See `isAgentMessagePost`.
            isMessagePost: isAgentMessagePost(resp.request().method(), url),
            // L2-C raw-byte seam: defer the (potentially large) body read until
            // the DEBUG-tier stub actually wants it. Swallow read errors so a
            // body that's already been consumed never throws into the probe.
            body: async () => {
              try {
                return resp.body !== undefined ? await resp.body() : null;
              } catch {
                return null;
              }
            },
          });
        } catch {
          /* never throw out of an event listener */
        }
      });
      page.on("request", (arg) => {
        try {
          const req = arg as { url(): string };
          const url = req.url();
          const queue = requestStartsByUrl.get(url);
          if (queue !== undefined) {
            queue.push(nowMonoMs());
            // Backstop for requests that NEVER terminate (no `response`, no
            // `requestfailed`) — e.g. a persistent SSE stream on a pooled,
            // long-lived page. Without this the queue grows unbounded (leak)
            // and a much-later same-URL response would shift an ancient stale
            // start → inflated `duration_ms`. Drop the OLDEST start(s) once the
            // queue exceeds the cap so it stays bounded and a response pairs
            // with a RECENT start.
            while (queue.length > CVDIAG_MAX_OUTSTANDING_STARTS_PER_URL) {
              queue.shift();
            }
          } else {
            requestStartsByUrl.set(url, [nowMonoMs()]);
          }
        } catch {
          /* ignore */
        }
      });
      // Evict the queued start for a request that ABORTS / FAILS / never
      // responds (Playwright fires `requestfailed` for abort, net error,
      // navigation-cancelled, etc.). Without this, an aborted same-URL request
      // leaks its start in the FIFO queue AND a LATER same-URL response shifts
      // that STALE start, mis-pairing the duration (inflated `duration_ms`).
      // Co-located with the `request` population listener (NOT in the
      // `onRequestFailed` block, which the caller may not wire) so eviction is
      // always active whenever timing is tracked. Drop the OLDEST outstanding
      // start for the URL — the failed request is, by FIFO ordering, the oldest
      // un-responded one for that URL.
      page.on("requestfailed", (arg) => {
        try {
          const req = arg as { url(): string };
          const url = req.url();
          const queue = requestStartsByUrl.get(url);
          if (queue !== undefined && queue.length > 0) {
            queue.shift();
            if (queue.length === 0) {
              requestStartsByUrl.delete(url);
            }
          }
        } catch {
          /* never throw out of an event listener */
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
  const cvdiagPbWriter = deps.cvdiagPbWriter;
  const abCollector = deps.abCollector;
  const abReachabilityCheck =
    deps.abReachabilityCheck ?? defaultReachabilityCheck;

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
          // Inject the PB writer seam (when wired) so the emitter's queued
          // probe-layer events PERSIST to cvdiag_events on flush. Absent
          // (no persistence configured) → no writer → flush is a no-op, the
          // pre-wiring behavior. The `CvdiagPbWriter` class satisfies the
          // emitter's `pbWriter` interface (its `writeBatch` maps each
          // envelope to a cvdiag_events row through the CREATE-only path).
          cvdiagEmitter = new CvdiagEmitter({
            env: ctx.env,
            layer: "probe",
            pbWriter: cvdiagPbWriter,
          });
        } catch (err) {
          ctx.logger.warn("probe.e2e-smoke.cvdiag-init-failed", {
            err: err instanceof Error ? err.message : String(err),
          });
          cvdiagEmitter = undefined;
        }
      }
      // Parse the DEBUG raw-byte allow-list ONCE from the probe env. DEBUG arms
      // raw-byte (PII-sensitive) capture only for the slugs explicitly listed in
      // `CVDIAG_DEBUG_ALLOW_LIST` — `captureRawBytes` enforces the per-slug scope.
      const cvdiagDebugAllowList = parseDebugAllowList(
        ctx.env.CVDIAG_DEBUG_ALLOW_LIST,
      );
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
          cvdiagPbWriter,
          cvdiagDebugAllowList,
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

        // CVDIAG Railway-internal routing A/B (spec Phase 8). DEFAULT OFF:
        // runs ONLY when `CVDIAG_AB_INTERNAL_URL` is set AND an `abCollector`
        // is wired. Issues a second request to the internal target (bypassing
        // the edge), correlated to the L3 edge run by a shared `ab_pair_id`,
        // and collects both arms' outcomes for the A/B report. The internal
        // arm's IPv4-reachability gate makes this a graceful no-op off-platform
        // (railway.internal is unresolvable locally). Pure instrumentation: a
        // throw here can NEVER change the probe's red/green outcome.
        const abInternalUrl = ctx.env[CVDIAG_AB_INTERNAL_URL_ENV];
        if (abCollector && abInternalUrl && abInternalUrl.length > 0) {
          try {
            const abPairId = mintAbPair();
            // The probe X-Test-Id (`d4-<slug>-<runId>`) is not a UUIDv7; mint a
            // fresh sanitizable id for the HMAC-signed A/B pairing.
            const abTestId = mintTestId();
            // Run the internal arm FIRST. The A/B feature only has meaning as a
            // PAIR (edge vs internal) — a lone edge record has no internal
            // sibling to diff against, so the report can only ever emit an
            // un-diffable orphan half-pair. When the internal arm is absent
            // (the documented common case: off-platform / CI / unreachable /
            // invalid-test-id / unset-secret / verify-fail → null), emit
            // NOTHING so downstream never sees a half-pair it cannot diff.
            const internalRecord = await runInternalAbArm({
              internalUrl: abInternalUrl,
              abPairId,
              testId: abTestId,
              slug,
              demo: "agentic-chat",
              env: ctx.env as Record<string, string | undefined>,
              fetchImpl: ctx.fetchImpl ?? globalThis.fetch,
              reachabilityCheck: abReachabilityCheck,
              now: ctx.now,
              logger: ctx.logger,
            });
            if (internalRecord !== null) {
              // Internal sibling exists → emit BOTH arms as a complete pair.
              // The edge record carries the REAL L3-captured edge response
              // headers (`l3.edgeHeaders`, already filtered) so
              // `edge_interference_signal` is computed from actual headers
              // (a cf-mitigated / retry-after edge response now surfaces as
              // true). Passing an empty bag here would structurally pin the
              // signal to `false` and defeat the whole edge-interference check.
              abCollector.collect(
                buildEdgeAbRecord({
                  abPairId,
                  testId: abTestId,
                  slug,
                  demo: "agentic-chat",
                  edgeState: l3.result.state === "green" ? "green" : "red",
                  edgeHeaders: l3.edgeHeaders,
                }),
              );
              abCollector.collect(internalRecord);
            }
          } catch (err) {
            ctx.logger.warn("probe.e2e-smoke.ab-fault", {
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
            cvdiagPbWriter,
            cvdiagDebugAllowList,
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
        // Drain the CVDIAG emitter's queued probe-layer events to PB before
        // returning. `flush()` is best-effort (no-op when no `pbWriter` was
        // injected, and never throws into the probe), so this can run
        // unconditionally and can NEVER change the probe's red/green outcome.
        try {
          await cvdiagEmitter?.flush();
        } catch (err) {
          ctx.logger.warn("probe.e2e-smoke.cvdiag-flush-failed", {
            slug,
            err: err instanceof Error ? err.message : String(err),
          });
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
  /** DEBUG-tier raw-byte sample writer (L2-C); absent → no raw-byte capture. */
  cvdiagPbWriter?: CvdiagPbWriter;
  /**
   * Parsed `CVDIAG_DEBUG_ALLOW_LIST` slug set. DEBUG raw-byte capture is scoped
   * to these slugs (per-slug match in `captureRawBytes`); empty → no capture.
   */
  cvdiagDebugAllowList: ReadonlySet<string>;
  assertResponse: (text: string) => { ok: boolean; summary: string };
}): Promise<{
  result: ProbeResult<E2eSmokeLevelSignal>;
  /**
   * The REAL edge headers captured from this level's agent-message POST
   * response (already passed through `filterEdgeHeaders`), or `undefined` when
   * no message-POST response was ever observed. Surfaced so the CVDIAG A/B arm
   * can compute `edge_interference_signal` from actual edge headers rather than
   * an empty bag (which would pin the signal to `false`).
   */
  edgeHeaders?: ReturnType<typeof filterEdgeHeaders>;
}> {
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
    cvdiagPbWriter,
    cvdiagDebugAllowList,
    assertResponse,
  } = opts;

  // CVDIAG session for THIS level (one test_id). The probe-layer test_id is
  // the per-level X-Test-Id so harness↔backend↔aimock correlate on the same
  // key. The forwarded X-Test-Id (`d4-/d6-<slug>-<runId>`) is not a UUIDv7, so
  // the session records `sanitizeJoinTestId(X-Test-Id)` — the SAME value the
  // backend adopts from the same inbound header — making probe.* rows JOIN
  // backend.* rows on `test_id` (spec §5).
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
    // The CVDIAG session opened above (~probe.start) MUST be closed even on
    // the abort-before-start early return — the documented invariant is that
    // `probe.exit` fires on EVERY path, so the per-level test_id always has an
    // open/close pair. The pre-fix early return skipped both `start` and
    // `exit`, leaving an unbalanced session (a `test_id` with no boundary rows
    // at all). Emit `probe.start` (open) then `probe.exit` (close, `timeout`
    // outcome: the level was aborted before it could run) so the session is
    // balanced and the abort is observable in the timeline. Both fire on the
    // `cvdiag` session which is undefined when instrumentation is off (no-op).
    cvdiag?.start(`${backendUrl}${demoPath}`, { width: 1280, height: 720 });
    cvdiag?.exit("timeout", 0);
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
  /**
   * `probe.message.send` char_count (Unicode code points, not UTF-16 units),
   * captured at send time but EMITTED after the message-POST response is
   * observed so the boundary carries real `edge_headers`. See `emitMessageSend`.
   */
  const messageCharCount = [...message].length;
  /**
   * Fire `probe.message.send` EXACTLY ONCE, with whatever edge headers have
   * been observed by then. The edge headers come from the message-POST
   * RESPONSE (the `onResponse` seam), which arrives AFTER `press("Enter")` —
   * so emitting at press time always saw an empty `messageSendEdge`. Emit from
   * the `onResponse` seam the moment the message-POST response lands (real edge
   * headers), with a fallback emit after the response wait so a run where no
   * message-POST response is ever observed still records the boundary (null
   * edge headers). `emitted` makes the two call sites idempotent.
   */
  let messageSendEmitted = false;
  const emitMessageSend = (): void => {
    if (messageSendEmitted) return;
    messageSendEmitted = true;
    cvdiag?.messageSend(0, messageCharCount, messageSendEdge);
  };
  /**
   * The most-recent agent-message POST response (L2-C): retained so the
   * DEBUG-tier raw-byte stub below can read its (lazily-fetched) body + the
   * content/transfer-encoding + content-type needed by the capture pipeline.
   */
  let lastMessagePostResp: CvdiagResponseEvent | undefined;
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
          // Retain the latest message-POST response for the DEBUG-tier
          // raw-byte stub. The body itself is read lazily (and only at DEBUG)
          // via `resp.body()` so non-DEBUG runs never pay the read.
          lastMessagePostResp = resp;
          // Now that the message-POST response (and its edge headers) is in
          // hand, emit `probe.message.send` with the REAL edge headers. Emitting
          // at press time (before this response) always saw empty edge headers.
          emitMessageSend();
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

    // probe.message.send is NOT emitted here: at press time the agent-message
    // POST has only just been ISSUED — its response (and thus its edge headers)
    // has not arrived yet, so emitting now would always record empty
    // `edge_headers`. The emit is driven from the `onResponse` seam above the
    // moment the message-POST response lands (real edge headers), with a
    // fallback `emitMessageSend()` after the response-wait below so a run where
    // no message-POST response is ever observed still records the boundary
    // (null edge headers). `char_count` (a USER-FACING Unicode code-point
    // count, computed once as `messageCharCount`) is timing-independent.

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

    // Fallback `probe.message.send`: the `onResponse` seam emits this the
    // moment the message-POST response lands (real edge headers). If no
    // message-POST response was ever observed (e.g. the page never issued one,
    // or it errored before responding), emit here so the boundary is still
    // recorded — idempotent via `emitMessageSend`, so a normal run that already
    // emitted from the seam is unaffected.
    emitMessageSend();

    // probe.dom.alternate_content — on a clean exit whose assistant text is
    // still empty (the d4 flap surface, class (d)): snapshot the child-element
    // type histogram of the assistant-message container so a markdown widget /
    // tool-result chip / code-block-only render is distinguishable from a
    // genuinely empty stream.
    if (cvdiag && cvdiagResponseEmpty && page) {
      const histogram = await readAlternateContentHistogram(page);
      cvdiag.alternateContent(histogram);

      // CVDIAG L2-C raw-byte capture (Phase 2.5): a 200-but-empty SSE response
      // is the canonical trigger. DEBUG-tier ONLY — gated below by the
      // emitter's resolved tier AND a wired pbWriter. `captureRawBytes` is a
      // hard no-op (returns null) at any non-debug tier, so this whole block
      // costs nothing on a normal run; we additionally avoid the body read.
      //
      // `cvdiagEmitter.tier` is set ONCE at construction and stays "debug" even
      // after DEBUG AUTO-DISARMS at runtime (the emitter's 10-minute /
      // 10k-event bounds): `shouldEmit` then degrades data-plane emits to
      // default-tier inclusion, but `tier` itself never flips. So
      // `tier === "debug"` alone does NOT prove DEBUG is still active — and
      // raw-byte body capture is the MOST PII-sensitive path CVDIAG has, so it
      // MUST stop the instant DEBUG disarms. Probe the live DEBUG-armed state
      // via the public `shouldEmit` of a debug-EXCLUSIVE boundary
      // (`aimock.sse.chunk` is `debug:true / verbose:false / default:false`):
      // it returns true ONLY while DEBUG is armed AND not expired, picking up
      // the auto-disarm fall-through. Gate the block on it AND thread it as the
      // real `debugEnabled` so the fail-closed invariant holds post-disarm
      // (replacing the previous misleading hardcoded `debugEnabled: true`).
      const debugActive =
        cvdiagEmitter?.shouldEmit("aimock.sse.chunk") === true;
      if (
        debugActive &&
        cvdiagPbWriter !== undefined &&
        lastMessagePostResp !== undefined
      ) {
        try {
          const resp = lastMessagePostResp;
          const body = resp.body !== undefined ? await resp.body() : null;
          if (body !== null) {
            const headers = resp.headers;
            const sample = captureRawBytes({
              slug,
              // Use the session's RESOLVED test_id (the minted UUIDv7 every
              // cvdiag_events row for this level carries), NOT the raw
              // `d4-<slug>-<runId>` X-Test-Id — otherwise the raw-byte sample's
              // test_id would never join back to the events timeline.
              testId: cvdiag.resolvedTestId,
              responseBody: body,
              contentEncoding: String(headers["content-encoding"] ?? ""),
              transferEncoding: String(headers["transfer-encoding"] ?? ""),
              contentType: String(headers["content-type"] ?? ""),
              tier: "debug",
              // The LIVE DEBUG-armed state (not a hardcoded `true`): once DEBUG
              // auto-disarms, `debugActive` is false, `captureRawBytes` returns
              // null, and no body is captured — fail-closed preserved.
              debugEnabled: debugActive,
              allowedSlugs: cvdiagDebugAllowList,
            });
            if (sample !== null) {
              await cvdiagPbWriter.writeRawByteSample(sample);
            }
          }
        } catch {
          // Pure instrumentation — a raw-byte capture/write fault must NEVER
          // throw into the probe it observes (spec §7 R5-F8).
        }
      }
    }

    const assertion = assertResponse(responseText);
    // probe.exit (completion path). A missing-VOCAB response is still a clean
    // MECHANICAL run (real response present) → `terminal_outcome=ok`, reflecting
    // probe mechanics not the green/red vocab assertion. But a run that produced
    // NOTHING — no SSE event AND no DOM first-token (`cvdiagResponseEmpty`) — is
    // a genuine probe FAILURE (e.g. a first-token timeout with sse_event_count=0)
    // that previously mislabeled itself `ok`, making reds indistinguishable from
    // greens in cvdiag. Label it `err` with the derived failure classifier so the
    // red is identifiable directly from probe.exit.
    if (cvdiagResponseEmpty) {
      cvdiagExit(cvdiag, "err");
    } else {
      cvdiagExit(cvdiag, "ok");
    }
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
      // Real captured edge headers (or undefined if no message-POST response
      // was observed) so the A/B arm can compute edge_interference_signal.
      edgeHeaders: messageSendEdge,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // probe.exit (error path) — `timeout` when the level aborted (the driver's
    // hard-timeout / external abort fired), else `err`. When the throw is a
    // `waitForTurnComplete` `TurnNotCompleteError` (duck-typed via its `reason`
    // field so this module stays decoupled from conversation-runner), thread the
    // authoritative reject reason as the failure classifier; otherwise `exit`
    // derives one from the probe's own observed signals.
    cvdiagExit(
      cvdiag,
      abortSignal.aborted ? "timeout" : "err",
      turnCompleteReason(err),
    );
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
      // Edge headers captured before the error (or undefined) — let the A/B
      // arm still compute edge_interference_signal on a failed edge run.
      edgeHeaders: messageSendEdge,
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
    failureClassifier?: CvdiagFailureClassifier,
  ): void {
    session?.exit(
      outcome,
      Math.round(nowMonoMs() - cvdiagStartMs),
      failureClassifier,
    );
  }
}

// `FAILURE_CLASSIFIER_SET` and `turnCompleteReason` were extracted to
// `../../cvdiag/probe-session.js` (imported at the top of this file) so the
// d5/d6 probe path can reuse the same thrown-error → failure-classifier guard.

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

// ── CVDIAG Railway-internal routing A/B (flap-observability spec Phase 8) ────
//
// OPTIONAL second probe run that targets the backend over Railway's INTERNAL
// network (bypassing the public edge), correlated to the public-edge run by a
// shared `ab_pair_id`. Diffing the two arms' outcomes (see `ab-report.ts`)
// detects edge-layer interference (Cloudflare-WAF-style).
//
// DEFAULT OFF: the entire path is gated on the `CVDIAG_AB_INTERNAL_URL` env
// var. When unset, NONE of this code runs and the probe's behaviour is exactly
// unchanged. The internal arm NEVER blocks or fails the normal probe run — an
// unreachable target, an unset HMAC secret, or any request error degrades the
// A/B to "skipped" (scope falls back to audit) and is swallowed.
//
// REPO REALITY: LGP binds `--host 0.0.0.0` (IPv4 wildcard) and Railway internal
// networking is dual-stack on environments created after 2025-10-16, so the
// internal target is reached over IPv4 (`<svc>.railway.internal` resolves to an
// IPv4 address). The A/B DEFAULTS to the IPv4 internal address; it does NOT
// assume IPv6. railway.internal is NOT resolvable from a local box, so the
// reachability gate below is the graceful-skip path that keeps local + CI runs
// from ever attempting (and timing out on) the internal hop.

/** Env var gating the A/B internal run; the internal target URL when set. */
export const CVDIAG_AB_INTERNAL_URL_ENV = "CVDIAG_AB_INTERNAL_URL";
/** Reachability-probe timeout (ms) for the IPv4 internal-target pre-check. */
const AB_REACHABILITY_TIMEOUT_MS = 2_000;
/** A/B internal-request timeout (ms). */
const AB_REQUEST_TIMEOUT_MS = 30_000;

/** Sink the A/B arm outcomes flow into; the report engine consumes these. */
export interface AbOutcomeCollector {
  collect(record: AbOutcomeRecord): void;
}

/**
 * IPv4 reachability check for the internal target. Returns true iff a
 * lightweight HEAD/GET to the target resolves over IPv4 within the timeout.
 * Best-effort: ANY error (DNS failure on a local box where railway.internal
 * does not resolve, connection refused, timeout) returns false so the A/B
 * SKIPS gracefully without ever blocking or failing the normal probe run.
 */
export type AbReachabilityCheck = (
  url: string,
  fetchImpl: typeof fetch,
) => Promise<boolean>;

const defaultReachabilityCheck: AbReachabilityCheck = async (
  url,
  fetchImpl,
) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), AB_REACHABILITY_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
    });
    // Any HTTP answer (even 4xx/5xx) proves the IPv4 socket reached a server;
    // we are gating on reachability, not on a healthy status.
    return resp.status >= 0;
  } catch {
    // DNS-unresolvable (railway.internal off-platform), refused, or timed out.
    return false;
  } finally {
    clearTimeout(t);
  }
};

/** Map an internal-arm HTTP result onto a probe terminal outcome. */
function abOutcomeFromStatus(status: number): CvdiagOutcome {
  return status >= 200 && status < 400 ? "ok" : "err";
}

export interface RunInternalAbArmOpts {
  /** The internal target URL (`CVDIAG_AB_INTERNAL_URL`). */
  internalUrl: string;
  /** Shared correlation id linking this internal arm to its edge sibling. */
  abPairId: string;
  /** The probe-layer test_id (lowercase UUIDv7). */
  testId: string;
  slug: string;
  demo: string;
  /** Env bag (carries `CVDIAG_AB_HMAC_SECRET`). */
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  reachabilityCheck: AbReachabilityCheck;
  now: () => Date;
  logger: { warn(event: string, meta?: Record<string, unknown>): void };
}

/**
 * Run the internal A/B arm: IPv4-reachability gate → HMAC-sign → issue the
 * internal request → return an `AbOutcomeRecord`. Returns `null` (skip — the
 * A/B degrades to audit-only) when:
 *   - the IPv4 target is unreachable (off-platform / local / CI), OR
 *   - the test_id fails sanitization, OR
 *   - the HMAC secret is unset (cannot self-authenticate the internal request).
 *
 * The returned record's HMAC is RE-VERIFIED before it is emitted (the
 * PB-writer A/B path must reject an unverified request); a verify failure
 * returns null so no row is produced for an unverified A/B request. Pure
 * instrumentation: every failure is swallowed and NEVER throws into the probe.
 */
export async function runInternalAbArm(
  opts: RunInternalAbArmOpts,
): Promise<AbOutcomeRecord | null> {
  const {
    internalUrl,
    abPairId,
    testId: rawTestId,
    slug,
    demo,
    env,
    fetchImpl,
    reachabilityCheck,
    logger,
  } = opts;
  try {
    // Sanitize the test_id BEFORE it is signed or sent (fail-closed).
    const testId = sanitizeTestId(rawTestId);
    if (testId === null) {
      logger.warn("probe.e2e-smoke.ab-skip", {
        reason: "invalid-test-id",
        slug,
      });
      return null;
    }

    // IPv4 reachability gate — skip gracefully if the internal target can't be
    // reached (the normal case off-platform). NEVER blocks the probe.
    const reachable = await reachabilityCheck(internalUrl, fetchImpl);
    if (!reachable) {
      logger.warn("probe.e2e-smoke.ab-skip", {
        reason: "internal-unreachable",
        slug,
      });
      return null;
    }

    // HMAC over <test_id>|<ts>|<slug>. A missing secret → null signature →
    // skip (cannot self-authenticate the edge-bypassing internal request).
    const ts = Date.now();
    const signature = signAbRequest({ testId, ts, slug }, env);
    if (signature === null) {
      logger.warn("probe.e2e-smoke.ab-skip", {
        reason: "hmac-secret-unset",
        slug,
      });
      return null;
    }

    // Issue the internal request carrying the HMAC + correlation headers.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), AB_REQUEST_TIMEOUT_MS);
    let outcome: CvdiagOutcome;
    try {
      const resp = await fetchImpl(internalUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "X-Test-Id": testId,
          "X-AIMock-Context": slug,
          "X-Cvdiag-Ab-Pair": abPairId,
          "X-Cvdiag-Ab-Ts": String(ts),
          "X-Cvdiag-Ab-Hmac": signature,
        },
      });
      outcome = abOutcomeFromStatus(resp.status);
    } catch (err) {
      // An aborted request → timeout; any other network error → err.
      outcome = controller.signal.aborted ? "timeout" : "err";
      logger.warn("probe.e2e-smoke.ab-internal-error", {
        slug,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(t);
    }

    // RE-VERIFY the HMAC before emitting the record. The PB-writer A/B path
    // rejects an unverified request, so a tuple/secret drift that breaks
    // verification yields NO row (do not write rows for unverified requests).
    if (!verifyAbRequest({ testId, ts, slug }, signature, env)) {
      logger.warn("probe.e2e-smoke.ab-skip", {
        reason: "hmac-verify-failed",
        slug,
      });
      return null;
    }

    return {
      ab_pair_id: abPairId,
      arm: "internal",
      test_id: testId,
      slug,
      demo,
      outcome,
      edge_interference_signal: false,
    };
  } catch (err) {
    // Pure instrumentation — the A/B must NEVER throw into the probe.
    logger.warn("probe.e2e-smoke.ab-internal-fault", {
      slug,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Build the edge-arm `AbOutcomeRecord` from a completed edge probe level. The
 * edge arm always exists (the normal probe ran); its outcome maps green→`ok`,
 * red→`err`. `edge_interference_signal` is true when the edge level surfaced a
 * cf-mitigated / retry-after header (best-effort; not load-bearing for the
 * report's divergence classification, which keys on the outcome diff).
 */
export function buildEdgeAbRecord(opts: {
  abPairId: string;
  testId: string;
  slug: string;
  demo: string;
  edgeState: "green" | "red";
  edgeHeaders?: ReturnType<typeof filterEdgeHeaders>;
}): AbOutcomeRecord {
  const interference =
    opts.edgeHeaders !== undefined &&
    ((opts.edgeHeaders["cf-mitigated"] ?? null) !== null ||
      (opts.edgeHeaders["retry-after"] ?? null) !== null);
  return {
    ab_pair_id: opts.abPairId,
    arm: "edge",
    test_id: sanitizeTestId(opts.testId) ?? opts.testId,
    slug: opts.slug,
    demo: opts.demo,
    outcome: opts.edgeState === "green" ? "ok" : "err",
    edge_interference_signal: interference,
  };
}

/** Mint a fresh `ab_pair_id` (16-hex; reuses the span-id minter). */
export function mintAbPair(): string {
  return mintAbPairId();
}

/** Default driver instance with the real Playwright launcher. Registered
 * by the orchestrator at boot. */
export const e2eChatToolsDriver = createE2eSmokeDriver();
