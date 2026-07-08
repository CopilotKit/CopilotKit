import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { truncateUtf8 } from "../../render/filters.js";
import { showcaseShapeSchema } from "../discovery/railway-services.js";
import { D5_REGISTRY, isD5FeatureType } from "../helpers/d5-registry.js";
import type {
  D5BuildContext,
  D5FeatureType,
  D5Script,
} from "../helpers/d5-registry.js";
import { demosToFeatureTypes } from "../helpers/d5-feature-mapping.js";
import { D5_REPRESENTATIVES } from "../helpers/d5-representatives.js";
import type { Page as PlaywrightPage } from "playwright";
import { countAssistantMessages } from "../helpers/assistant-message-count.js";
import { runConversation } from "../helpers/conversation-runner.js";
import type {
  ConversationResult,
  Page,
} from "../helpers/conversation-runner.js";
import {
  installPrePaintFromEnv,
  installBrowserContextShims,
  messagesOverrideFromEnv,
} from "../helpers/init-scripts.js";
import { attachSseInterceptor } from "../helpers/sse-interceptor.js";
import {
  formatCvdiag,
  appendHop,
  mintRunId,
  X_AIMOCK_CONTEXT,
  X_DIAG_RUN_ID,
  X_DIAG_HOPS,
} from "../helpers/cv-diag.js";
import { writeDiagEvent } from "../../storage/diag-sink.js";
import type { DiagSinkClient } from "../../storage/diag-sink.js";
import { CvdiagEmitter } from "../../cvdiag/index.js";
import {
  CvdiagProbeSession,
  defaultCvdiagBufferDir,
  FAILURE_CLASSIFIER_SET,
  nowMonoMs,
  turnCompleteReason,
} from "../../cvdiag/probe-session.js";
import type { CvdiagFailureClassifier } from "../../cvdiag/index.js";
import type { CvdiagPbWriter } from "../../cvdiag/pb-writer.js";
import type { ProbeDriver } from "../types.js";
import type { Logger, ProbeContext, ProbeResult } from "../../types/index.js";
import type { BrowserPool } from "../helpers/browser-pool.js";
import { emitAggregate, sideEmit } from "../helpers/d6-emit.js";
import { isSpecDriven } from "../helpers/spec-driven-slugs.js";
import type { RunSpecDrivenD6Result } from "../../cli/e2e.js";
import type playwright from "playwright";

/**
 * D6 — e2e-full ("everything works") driver.
 *
 * One driver invocation handles one Railway showcase service. Unlike the
 * D5 e2e-deep driver (which picks one representative per feature type),
 * the D6 driver iterates ALL feature types the integration declares via
 * `demosToFeatureTypes` — the full matrix, not a sampled subset.
 *
 * For every D5 feature type the integration declares, the driver:
 *   1. Looks up the script in `D5_REGISTRY` (populated by the dynamic
 *      loader scanning `src/probes/scripts/d5-*.{js,ts}` at boot).
 *   2. FAILS with red when the registry has no script for that
 *      featureType — unlike D5 which skips with green, D6 treats
 *      missing scripts as a hard failure.
 *   3. Opens a fresh Playwright context with `X-AIMock-Context: <slug>`
 *      and `X-Test-Id: d6-<slug>-<runId>` headers (see `buildE2eTestId`;
 *      the runId suffix gives each run fresh aimock fixture-count state —
 *      the old per-slug constant id caused the staging flap), navigates to
 *      the per-feature route, and runs the conversation through
 *      `runConversation`.
 *   4. Emits one `d6:<slug>/<featureType>` diagnostic side row per
 *      feature (not consumed by dashboard rollup — diagnostic only).
 *   5. Emits an aggregate `d6:<slug>` primary result that is green ONLY
 *      if ALL features passed.
 *
 * State mapping:
 *   - green  — every feature completed with no assertion failure.
 *   - red    — any feature failed, any script missing, or launcher error.
 *
 * Uses Semaphore, D5_REGISTRY scripts, runConversation, deploy-churn
 * grace window, and abort plumbing (this driver now owns these directly;
 * the former separate e2e-deep.ts driver was deleted when D5 became
 * "D6 take-one").
 */

/**
 * Grace period (ms) after a Railway deployment's `createdAt` during
 * which the driver skips all features for the service. Eliminates
 * deploy-churn false-reds without sacrificing probe efficiency.
 */
export const DEPLOY_CHURN_GRACE_MS = 120_000;

const inputSchema = z
  .object({
    key: z.string().min(1),
    backendUrl: z.string().url().optional(),
    publicUrl: z.string().url().optional(),
    name: z.string().optional(),
    features: z.array(z.string()).optional(),
    demos: z.array(z.string()).optional(),
    /**
     * Integration's manifest `not_supported_features` set. Features in
     * this list are architecturally incapable on the framework, NOT
     * regressions. The driver reclassifies them as `skipped-incapable`
     * (green side-row + `skipped[]` in the aggregate) instead of running
     * a probe that would always fail and report red.
     */
    notSupportedFeatures: z.array(z.string()).optional(),
    shape: showcaseShapeSchema.optional(),
    deployedAt: z.string().optional(),
    /**
     * D5-take-one scoping. When true, the computed `requestedFeatures`
     * are filtered to ONLY the featureTypes present in the representatives
     * map (`D5_REPRESENTATIVES`), so the driver runs one representative per
     * feature category instead of the full D6 matrix. The D5 probe sets
     * this so it runs under the D6 driver's EXACT conditions (same route,
     * headers, conversation, pooled launcher) but on a single pill.
     */
    representativeOnly: z.boolean().optional(),
    /**
     * Dashboard row-key prefix. Threaded through every emitted PB row —
     * per-cell side rows (`${rowPrefix}:${slug}/${ft}`) and the aggregate
     * (`${rowPrefix}:${slug}`). Defaults to `"d6"`. The D5 probe sets
     * `"d5"` so the dashboard's D5 column reads the same conditions the D6
     * driver greens.
     */
    rowPrefix: z.enum(["d5", "d6"]).optional(),
    /**
     * Driver-invocation outer-cap (ms) conveyed by the fleet enumerator so the
     * worker's pooled d6 driver honors the YAML `timeout_ms`
     * (`d6-all-pills-e2e.yml` 20 min / `e2e-deep.yml` 10 min). The fleet worker
     * never runs the legacy in-process `probe-invoker` boot path that applies
     * `cfg.timeout_ms`, so without this the driver falls back to its hardcoded
     * `DEFAULT_TIMEOUT_MS` (10 min) and a slow backend false-aborts. See the
     * timeout-resolution block in `e2eFullDriver.run`.
     */
    timeout_ms: z.number().int().positive().optional(),
  })
  .passthrough()
  .refine((v) => !!(v.backendUrl ?? v.publicUrl), {
    message: "backendUrl or publicUrl is required",
    path: ["backendUrl"],
  });

type E2eFullDriverInput = z.infer<typeof inputSchema>;

/**
 * Per-feature side-emit signal carried on each `d6:<slug>/<featureType>` row.
 * Diagnostic only — not consumed by dashboard rollup.
 */
export interface E2eFullFeatureSignal {
  slug: string;
  featureType: string;
  backendUrl: string;
  url?: string;
  fixtureFile?: string;
  turns_completed?: number;
  total_turns?: number;
  failure_turn?: number;
  turn_durations_ms?: number[];
  errorDesc?: string;
  errorClass?: string;
  note?: string;
  diagnostics?: Record<string, unknown>;
}

/**
 * Aggregate signal carried on the primary `d6:<slug>` row.
 * Green only if ALL features pass.
 *
 * `skipped` is a union of three reasons: filtered-by-trigger (operator
 * intent), deploy-churn (transient deploy state), and incapable
 * (manifest `not_supported_features` — framework primitive gap). The
 * driver does NOT distinguish them in the aggregate count because they
 * all share the "not counted as red" semantic. `incapable` is broken
 * out separately so dashboard / operators can tell genuine architectural
 * skips apart from operational ones.
 */
export interface E2eFullAggregateSignal {
  shape: "package";
  slug: string;
  backendUrl: string;
  total: number;
  passed: number;
  failed: string[];
  skipped: string[];
  /**
   * Subset of `skipped` representing manifest `not_supported_features`
   * — features the integration's framework architecturally cannot
   * support. Distinct from operational skips (deploy-churn, trigger
   * filter). Empty when the manifest declares no NSF or no requested
   * feature intersects it.
   */
  incapable?: string[];
  note?: string;
  errorDesc?: string;
  failureSummary?: string;
}

/**
 * Minimal page surface the driver depends on. Exported as `E2eFullPage`.
 */
export interface E2eFullPage extends Page {
  goto(
    url: string,
    opts?: {
      waitUntil?: "networkidle" | "domcontentloaded" | "load";
      timeout?: number;
    },
  ): Promise<unknown>;
  close(): Promise<void>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  waitForFunction(
    fn: () => boolean,
    opts?: { timeout?: number },
  ): Promise<unknown>;
  getDiagnostics?(): { consoleLogs: string[]; requestFailures: string[] };
  isClosed?(): boolean;
  locator?(selector: string): { count(): Promise<number> };
  route?(
    url: string | RegExp,
    handler: (
      route: { continue(): Promise<void> },
      request: { url(): string; method(): string; postData(): string | null },
    ) => void | Promise<void>,
  ): Promise<unknown>;
  unroute?(url: string | RegExp): Promise<unknown>;
}

export interface E2eFullBrowserContext {
  newPage(): Promise<E2eFullPage>;
  close(): Promise<void>;
}

export interface E2eFullBrowser {
  newContext(opts?: {
    extraHTTPHeaders?: Record<string, string>;
  }): Promise<E2eFullBrowserContext>;
  close(): Promise<void>;
}

export type E2eFullBrowserLauncher = (
  abortSignal?: AbortSignal,
) => Promise<E2eFullBrowser>;

export type E2eFullScriptLoader = (ctx: ProbeContext) => Promise<void>;

export interface E2eFullDriverDeps {
  launcher?: E2eFullBrowserLauncher;
  pageTimeoutMs?: number;
  timeoutMs?: number;
  featureTimeoutMs?: number;
  scriptLoader?: E2eFullScriptLoader;
  /**
   * The representatives map consulted when an input sets
   * `representativeOnly: true`. Defaults to `D5_REPRESENTATIVES`. Injectable
   * so unit tests can narrow the set and exercise the filter
   * discriminatingly (the live map covers every featureType).
   */
  representatives?: Readonly<Partial<Record<D5FeatureType, string>>>;
  /**
   * CVDIAG instrumentation sink (best-effort). When provided, the driver
   * writes a `diag_events` row at the post-run aimock-journal join
   * (`boundary=cv-verdict`) so the CV-propagation chain is pullable over
   * HTTP after Railway's stdout log window rolls off. Injected rather than
   * constructed inside the driver because `ProbeContext` carries no PB
   * handle; the orchestrator/CLI that already owns a `PbClient` threads it
   * here. Absent → the journal-join CVDIAG line is still emitted to stdout,
   * only the durable row is skipped. NEVER load-bearing: a write failure is
   * swallowed by `writeDiagEvent` and can never break a probe.
   */
  diagPb?: DiagSinkClient;
  /**
   * CVDIAG flap-observability emitter (spec §3 Layer 1). When provided (or
   * constructed from `ctx.env` on first use), each feature run constructs a
   * `CvdiagProbeSession` and emits the probe-layer boundaries — notably
   * `probe.exit` carrying `terminal_outcome` + `failure_classifier` — so the
   * flapping d5/d6 runs are readable from `cvdiag_events`. This is the SAME
   * session the d4 driver uses (extracted to `cvdiag/probe-session.ts`).
   * Injectable so unit tests can supply a VERBOSE emitter with a captured
   * PB-writer seam and assert envelopes without a live PB. CVDIAG is pure
   * instrumentation — a missing or failing emitter NEVER changes a probe's
   * red/green outcome.
   */
  cvdiagEmitter?: CvdiagEmitter;
  /**
   * CVDIAG event-persistence writer. When provided, the driver injects it into
   * the `CvdiagEmitter` it constructs so the queued probe-layer events PERSIST
   * to the `cvdiag_events` collection on flush (the emit→persist seam). The
   * fleet worker / CLI constructs one from a writer-role PB connection; absent
   * → events emit to the queue but the durable write is a no-op. Never
   * load-bearing: a write failure can't break a probe.
   */
  cvdiagPbWriter?: CvdiagPbWriter;
  /**
   * Root directory for the per-test replay-fallback ndjson buffer
   * (`<dir>/<date>/<test-id>.ndjson`). Defaults to `~/.cvdiag/buffer`.
   * Injectable so tests buffer into a tmpdir. Best-effort: a write failure is
   * swallowed and never breaks a probe.
   */
  cvdiagBufferDir?: string;
  /**
   * Factory for the per-`run()` correlation id (`runId`). Defaults to
   * `mintRunId` (`crypto.randomUUID()`). Injectable ONLY so unit tests can
   * supply a deterministic counter and assert the per-run-unique X-Test-Id
   * (`d6-<slug>-<runId>`) without matching a brittle UUID regex. Production
   * always uses the default. The id is minted once per `run()` and is stable
   * across every feature-cell of that run, unique across runs.
   */
  idFactory?: () => string;
  /**
   * Injectable spec-driven verdict runner. Called only when `isSpecDriven(slug)`
   * returns true. Signature matches `runSpecDrivenD6` from `cli/e2e.ts`, which
   * cannot be statically imported here (circular dep: cli/e2e → d6-all-pills →
   * cli/e2e). Production path uses a dynamic import resolved once per `run()`.
   * Unit tests inject a stub that returns known verdicts without Playwright.
   *
   * Options subset passed by the driver:
   *   backendUrl           — the resolved target URL.
   *   integrationDir       — resolved from SHOWCASE_DIR / process.cwd().
   *   timeoutMs            — from the driver's resolved outer-cap (guarded).
   *   notSupportedFeatures — forwarded from input so NSF cells become SKIPPED.
   *   signal               — the driver's wall-clock abort signal.
   *   ctx                  — the probe context (writer + logger).
   *
   * @internal Injectable for testing; production relies on the dynamic-import default.
   */
  specDrivenRunner?: (
    slug: string,
    opts: {
      backendUrl: string;
      integrationDir: string;
      timeoutMs?: number;
      notSupportedFeatures?: string[];
      signal?: AbortSignal;
      ctx: ProbeContext;
    },
  ) => Promise<RunSpecDrivenD6Result>;
  /**
   * Injectable dynamic-import resolver for the spec-driven runner module.
   * Production: `(specifier) => import(specifier)`. Injectable so tests can
   * force the import path to throw (exercising the spec-driven-import-error
   * catch block) without relying on a missing module on disk.
   *
   * Only consulted when `specDrivenRunner` is NOT provided — i.e. when the
   * production dynamic-import path is active. When `specDrivenRunner` is
   * injected directly, this dep is ignored.
   *
   * @internal Injectable for testing only.
   */
  specDrivenImportResolver?: (specifier: string) => Promise<unknown>;
}

/**
 * Build the per-feature aimock X-Test-Id. Folds the per-`run()` correlation
 * id (`runId`) into the previously per-slug-only id so each run starts from a
 * fresh aimock per-test-id fixture-match count, eliminating the cross-run
 * sequence/turn-count desync that flapped the staging dashboard. Stable across
 * a run's feature-cells (same `runId`), unique across runs. D5 runs THIS driver
 * (take-one), so it is covered by the same `d6-` value; the D5 dashboard column
 * is derived from `rowPrefix`, not from this header.
 */
export function buildE2eTestId(slug: string, runId: string): string {
  return `d6-${slug}-${runId}`;
}

/**
 * 10-minute global D6 wall-clock budget. With higher concurrency (4)
 * the full matrix should fit comfortably.
 */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PAGE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_FEATURE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * D6 runs 4 features concurrently (vs D5's 2). Higher parallelism
 * because D6 is the full matrix and needs to complete within budget.
 */
export const FEATURE_CONCURRENCY_D6 = 4;

/**
 * Inline counting semaphore — gates concurrent access to a bounded
 * resource (here: browser contexts). Same implementation as e2e-deep.
 */
export class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error(`Semaphore limit must be >= 1, got ${limit}`);
    }
  }
  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    if (this.active <= 0) {
      throw new Error("Semaphore.release() called without matching acquire()");
    }
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
}

/** Default route shape for a feature when the script doesn't override. */
function defaultRoute(featureType: D5FeatureType, _ctx?: unknown): string {
  return `/demos/${featureType}`;
}

const isKnownFeatureType: (value: string) => value is D5FeatureType =
  isD5FeatureType;

/**
 * Minimal shape of a raw Playwright `Browser` the guarded-open helper needs:
 * an `isConnected()` liveness predicate plus `newContext`. Lets the guard be
 * unit-tested with a fake whose connectivity toggles, without launching a real
 * Chromium.
 */
export interface GuardableBrowser {
  isConnected(): boolean;
  newContext(opts?: {
    extraHTTPHeaders?: Record<string, string>;
  }): Promise<unknown>;
}

/**
 * Sentinel error class for the "the shared browser is no longer live" case so
 * the feature loop can classify it distinctly (and so a regression test can
 * assert the exact failure mode rather than matching Playwright's internal
 * "Target page, context or browser has been closed" string).
 */
export class BrowserDisconnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserDisconnectedError";
  }
}

/**
 * Open a context on a SINGLE shared raw browser, guarding the open against the
 * browser having disconnected/crashed.
 *
 * The single-shared-browser launcher (`defaultLauncher`, and the CLI's headed
 * launcher) opens one Chromium and then opens a CONTEXT per feature on it,
 * concurrently (bounded by `FEATURE_CONCURRENCY_D6`). Under the D6 fan-out's
 * Chromium-spawn / memory burst — heaviest for byoc — the shared browser can
 * crash or be disconnected mid-run. The unguarded code called
 * `browser.newContext()` directly, so every feature that acquired AFTER the
 * disconnect threw the raw Playwright `browser.newContext: Target page, context
 * or browser has been closed`, which the feature loop classified as an opaque
 * `driver-error` (or `abort`) on ~every remaining cell.
 *
 * The guarded open mirrors the POOLED launcher's lifecycle model ("only open
 * contexts on a LIVE browser"): it (1) refuses to open on an already-dead
 * browser, and (2) re-checks liveness after the open settles so a disconnect
 * DURING the in-flight `newContext()` is reported as a clean, classifiable
 * `BrowserDisconnectedError` instead of leaking Playwright's internal "has been
 * closed" string. Either way the feature goes red with a clear reason — it does
 * NOT throw the opaque raw error.
 */
export async function openGuardedContext<C>(
  browser: GuardableBrowser,
  opts?: { extraHTTPHeaders?: Record<string, string> },
): Promise<C> {
  // (1) The browser already died before we even tried — fail this feature
  //     cleanly rather than calling newContext() on a dead process (which would
  //     throw the raw "has been closed").
  if (!browser.isConnected()) {
    throw new BrowserDisconnectedError(
      "shared browser disconnected before context open",
    );
  }
  let ctx: C;
  try {
    ctx = (await browser.newContext(opts)) as C;
  } catch (err) {
    // (2a) The browser disconnected WHILE the open was in flight: Playwright
    //      throws the raw "has been closed". Re-throw as the sentinel so the
    //      feature loop classifies it distinctly instead of surfacing the
    //      opaque internal string.
    if (!browser.isConnected()) {
      throw new BrowserDisconnectedError(
        "shared browser disconnected during context open",
      );
    }
    // (2b) A genuinely transient open error on a STILL-live browser — surface
    //      the original error unchanged (this feature fails, siblings continue).
    throw err;
  }
  return ctx;
}

/**
 * Default Playwright-backed launcher. Sets X-AIMock-Strict header at the
 * browser level. Per-context headers (X-AIMock-Context, X-Test-Id) are
 * set per-feature in newContext calls from the feature loop.
 */
const defaultLauncher: E2eFullBrowserLauncher =
  async (): Promise<E2eFullBrowser> => {
    const mod = (await import("playwright")) as typeof playwright;
    const browser = await mod.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return {
      async newContext(contextOpts?: {
        extraHTTPHeaders?: Record<string, string>;
      }): Promise<E2eFullBrowserContext> {
        // GUARD: open the context on the shared browser only while it is LIVE,
        // and convert a mid-open disconnect into a clean BrowserDisconnectedError
        // instead of leaking Playwright's raw "has been closed" string (which
        // the feature loop would surface as an opaque driver-error on every
        // remaining byoc cell). See openGuardedContext for the full rationale.
        const ctx = await openGuardedContext<playwright.BrowserContext>(
          browser,
          {
            extraHTTPHeaders: {
              "X-AIMock-Strict": "true",
              ...contextOpts?.extraHTTPHeaders,
            },
          },
        );
        return {
          async newPage(): Promise<E2eFullPage> {
            const page = await ctx.newPage();

            const consoleLogs: string[] = [];
            const requestFailures: string[] = [];

            page.on("console", (msg) => {
              const t = msg.type();
              if (t === "error" || t === "warning") {
                consoleLogs.push(`[${t}] ${msg.text().slice(0, 200)}`);
              }
            });

            page.on("requestfailed", (request) => {
              requestFailures.push(
                `${request.method()} ${request.url().slice(0, 200)} => ${
                  request.failure()?.errorText || "unknown"
                }`,
              );
            });

            const wrapped: E2eFullPage = {
              waitForSelector: (s, o) => page.waitForSelector(s, o),
              fill: (s, v, o) => page.fill(s, v, o),
              press: (s, k, o) => page.press(s, k, o),
              evaluate: <R>(fn: () => R) => page.evaluate(fn),
              inputValue: (s) => page.inputValue(s),
              goto: async (u, gotoOpts) => {
                // Order is load-bearing per Phase 3 Task 3.2:
                // installPrePaintFromEnv FIRST (defect-4 pre-paint
                // injection, no-op in production), attachSseInterceptor
                // SECOND. Both must complete before page.goto so the
                // init scripts (pre-paint DOM seed + __hk_runsFinished
                // window counter) are registered at document_start.
                await installBrowserContextShims(page);
                await installPrePaintFromEnv(page);
                await attachSseInterceptor(page);
                return page.goto(
                  u,
                  gotoOpts as Parameters<typeof page.goto>[1],
                );
              },
              close: () => page.close(),
              click: (s, o) => page.click(s, o),
              waitForFunction: (fn, wfOpts) =>
                page.waitForFunction(
                  fn as Parameters<typeof page.waitForFunction>[0],
                  undefined,
                  wfOpts,
                ),
              getDiagnostics: () => ({
                consoleLogs: consoleLogs.slice(-20),
                requestFailures: requestFailures.slice(-10),
              }),
              isClosed: () => page.isClosed(),
              locator: (s) => page.locator(s),
              route: (u, handler) =>
                page.route(u, handler as Parameters<typeof page.route>[1]),
              unroute: (u) => page.unroute(u),
            };
            return wrapped;
          },
          close: () => ctx.close(),
        };
      },
      close: () => browser.close(),
    };
  };

export function createPooledE2eFullLauncher(
  pool: BrowserPool,
  logger?: { warn(event: string, meta?: Record<string, unknown>): void },
): E2eFullBrowserLauncher {
  return async (abortSignal?: AbortSignal): Promise<E2eFullBrowser> => {
    // CONTEXT-POOLED model: each newContext() checks out a pooled
    // BrowserContext (X-AIMock-Strict centralized in the pool; per-feature
    // X-AIMock-Context / X-Test-Id flow through `contextOpts`) and the
    // wrapper's close() releases it. The dead-browser re-acquire dance is
    // gone: the pool only opens contexts on live browsers (acquire skips
    // recycling/disconnected browsers and retries on another if newContext
    // throws), so a dead process can never be handed to a feature. The abort
    // closure re-targets onto the open contexts: on abort it closes each
    // (each close() releases its pooled context). There is no Browser held.
    let aborted = false;
    const openContexts = new Set<{ close(): Promise<void> }>();

    const onAbort = (): void => {
      if (aborted) return;
      aborted = true;
      const ctxCount = openContexts.size;
      const stats = pool.stats();
      logger?.warn("probe.e2e-full.pool-abort-release", {
        openContexts: ctxCount,
        poolAvailable: stats.available,
        poolInUse: stats.inUse,
        poolSize: stats.size,
      });
      const contextClosePromises = Array.from(openContexts).map((ctx) =>
        ctx.close().catch(() => {}),
      );
      void Promise.allSettled(contextClosePromises).then(() => {
        logger?.warn("probe.e2e-full.pool-abort-released", {
          closedContexts: ctxCount,
          poolAvailable: pool.stats().available,
        });
      });
    };
    // Capture the listener so launcher-level close() can detach it: without
    // removeEventListener a post-completion abort would fire onAbort after the
    // run returned, leaking the listener for the signal's lifetime.
    let detachAbort: (() => void) | undefined;
    if (abortSignal) {
      if (abortSignal.aborted) {
        aborted = true;
        logger?.warn("probe.e2e-full.pool-pre-aborted-release");
      } else {
        abortSignal.addEventListener("abort", onAbort, { once: true });
        detachAbort = () => abortSignal.removeEventListener("abort", onAbort);
      }
    }

    return {
      async newContext(contextOpts?: {
        extraHTTPHeaders?: Record<string, string>;
      }): Promise<E2eFullBrowserContext> {
        const ctx = await pool.acquire({
          extraHTTPHeaders: contextOpts?.extraHTTPHeaders,
        });
        // If the signal was already aborted at launcher construction (the
        // pre-aborted branch never attached the live abort listener), a context
        // opened now would never be closed by the abort path. Release it
        // immediately and refuse so it cannot leak into a torn-down run.
        if (aborted) {
          await pool.release(ctx).catch(() => {});
          throw new Error("e2e-full launcher aborted");
        }
        const ctxHandle = { close: () => pool.release(ctx) };
        openContexts.add(ctxHandle);
        return {
          async newPage(): Promise<E2eFullPage> {
            const page = await ctx.newPage();

            const consoleLogs: string[] = [];
            const requestFailures: string[] = [];

            page.on("console", (msg) => {
              const t = msg.type();
              if (t === "error" || t === "warning") {
                consoleLogs.push(`[${t}] ${msg.text().slice(0, 200)}`);
              }
            });

            page.on("requestfailed", (request) => {
              requestFailures.push(
                `${request.method()} ${request.url().slice(0, 200)} => ${
                  request.failure()?.errorText || "unknown"
                }`,
              );
            });

            const wrapped: E2eFullPage = {
              waitForSelector: (s, o) => page.waitForSelector(s, o),
              fill: (s, v, o) => page.fill(s, v, o),
              press: (s, k, o) => page.press(s, k, o),
              evaluate: <R>(fn: () => R) => page.evaluate(fn),
              inputValue: (s) => page.inputValue(s),
              goto: async (u, gotoOpts) => {
                // Order is load-bearing per Phase 3 Task 3.2:
                // installPrePaintFromEnv FIRST (defect-4 pre-paint
                // injection, no-op in production), attachSseInterceptor
                // SECOND. Both must complete before page.goto so the
                // init scripts (pre-paint DOM seed + __hk_runsFinished
                // window counter) are registered at document_start.
                await installBrowserContextShims(page);
                await installPrePaintFromEnv(page);
                await attachSseInterceptor(page);
                return page.goto(
                  u,
                  gotoOpts as Parameters<typeof page.goto>[1],
                );
              },
              close: () => page.close(),
              click: (s, o) => page.click(s, o),
              waitForFunction: (fn, wfOpts) =>
                page.waitForFunction(
                  fn as Parameters<typeof page.waitForFunction>[0],
                  undefined,
                  wfOpts,
                ),
              getDiagnostics: () => ({
                consoleLogs: consoleLogs.slice(-20),
                requestFailures: requestFailures.slice(-10),
              }),
              isClosed: () => page.isClosed(),
              locator: (s) => page.locator(s),
              route: (u, handler) =>
                page.route(u, handler as Parameters<typeof page.route>[1]),
              unroute: (u) => page.unroute(u),
            };
            return wrapped;
          },
          close: async () => {
            openContexts.delete(ctxHandle);
            await pool.release(ctx);
          },
        };
      },
      // Launcher-level close releases nothing itself (each context releases
      // itself) but detaches the abort listener so a post-completion abort
      // can't fire onAbort after the run returned.
      close: async () => {
        detachAbort?.();
      },
    };
  };
}

/**
 * D5 script file matcher — reused from e2e-deep for the shared script
 * loader. Accepts `d5-<name>.{js,ts}` but rejects test files, .d.ts,
 * and non-d5 prefixed files.
 */
export const D5_SCRIPT_FILE_MATCHER =
  /^d5-(?!.*\.test\.)(?!.*\.d\.).*\.(js|ts)$/;

/**
 * Default script loader — scans `<driverDir>/../scripts/` for D5 script
 * files. Same as e2e-deep's loader.
 */
export const defaultScriptLoader: E2eFullScriptLoader = async (
  ctx: ProbeContext,
): Promise<void> => {
  const here = fileURLToPath(import.meta.url);
  const scriptsDir = path.resolve(path.dirname(here), "..", "scripts");

  let entries: string[];
  try {
    entries = await fs.readdir(scriptsDir);
  } catch (err) {
    ctx.logger.warn("probe.e2e-full.scripts-dir-missing", {
      scriptsDir,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const matched = entries.filter((name) => D5_SCRIPT_FILE_MATCHER.test(name));
  if (matched.length === 0) {
    ctx.logger.warn("probe.e2e-full.no-scripts-found", { scriptsDir });
    return;
  }

  for (const name of matched) {
    const url = pathToFileURL(path.join(scriptsDir, name)).href;
    try {
      await import(url);
    } catch (err) {
      ctx.logger.error("probe.e2e-full.script-import-failed", {
        scriptsDir,
        name,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

/**
 * Derive `incapable[]` for a spec-driven aggregate exit from the intersection
 * of `skipped` cells and `notSupportedFeatures`. Returns `undefined` when the
 * intersection is empty (or when no NSF set was provided) so the field is
 * absent from the signal rather than present as an empty array — mirrors the
 * heuristic path convention and the J2-fix-1 normal-exit computation.
 *
 * Applied at EVERY spec-driven exit that carries a populated `skipped[]` so
 * the "incapable ⊆ skipped" contract holds on interrupted (timeout/drain/
 * mismatch) runs as well as on normal completion.
 */
function computeSdIncapable(
  skipped: readonly string[],
  notSupportedFeatures: readonly string[] | undefined,
): string[] | undefined {
  if (!notSupportedFeatures || notSupportedFeatures.length === 0)
    return undefined;
  const nsfSet = new Set<string>(notSupportedFeatures);
  const intersection = skipped.filter((cell) => nsfSet.has(cell));
  return intersection.length > 0 ? intersection : undefined;
}

export function createE2eFullDriver(
  deps: E2eFullDriverDeps = {},
): ProbeDriver<E2eFullDriverInput, E2eFullAggregateSignal> {
  const launcher = deps.launcher ?? defaultLauncher;
  // Construction-time fallback cap. The EFFECTIVE per-run cap is resolved inside
  // `run()` so the fleet enumerator's conveyed `input.timeout_ms` (the YAML
  // budget) wins over this singleton-registration default. See the resolution
  // block in `run()`.
  const depTimeoutMs = deps.timeoutMs;
  const pageTimeoutMs = deps.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const featureTimeoutMs = deps.featureTimeoutMs ?? DEFAULT_FEATURE_TIMEOUT_MS;
  const scriptLoader = deps.scriptLoader ?? defaultScriptLoader;
  const representatives = deps.representatives ?? D5_REPRESENTATIVES;
  const diagPb = deps.diagPb;
  const idFactory = deps.idFactory ?? mintRunId;
  // CVDIAG probe-session deps (best-effort). The emitter may be injected (tests)
  // or constructed once per `run()` from `ctx.env`; the PB writer + buffer dir
  // are resolved here so the per-feature sessions persist + buffer.
  const cvdiagPbWriter = deps.cvdiagPbWriter;
  const cvdiagBufferDir = deps.cvdiagBufferDir ?? defaultCvdiagBufferDir();
  // Spec-driven runner injectable. Production default resolved once per
  // run() via dynamic import to avoid the static d6-all-pills ↔ cli/e2e
  // circular dep. Unit tests inject a stub.
  const specDrivenRunner = deps.specDrivenRunner;
  // Import resolver for the spec-driven runner module. Production default
  // uses the native dynamic import. Injectable so tests can force import
  // failures without needing a missing module on disk.
  const specDrivenImportResolver =
    deps.specDrivenImportResolver ?? ((specifier: string) => import(specifier));

  return {
    kind: "e2e_d6",
    inputSchema,
    async run(
      ctx: ProbeContext,
      input: E2eFullDriverInput,
    ): Promise<ProbeResult<E2eFullAggregateSignal>> {
      const observedAt = ctx.now().toISOString();
      const backendUrl = (input.backendUrl ?? input.publicUrl)!;
      const slug = deriveSlug(input.key, input.name);

      // ── Spec-driven verdict branch ────────────────────────────────────────
      // When `isSpecDriven(slug)` returns true (Phase 0: always false because
      // spec-driven-slugs.json ships empty), delegate verdict computation to
      // the shared `runSpecDrivenD6` pipeline instead of the heuristic
      // conversation runner. The D5 take-one path (rowPrefix="d5") always
      // keeps the heuristic regardless — spec-driven verdicts are D6-only.
      //
      // Production uses a dynamic import of cli/e2e.ts to avoid the static
      // circular dep (cli/e2e → d6-all-pills → cli/e2e). Tests inject a stub
      // via deps.specDrivenRunner.
      if (isSpecDriven(slug) && input.rowPrefix !== "d5") {
        // ── F5: Resolve and guard the outer timeout cap ─────────────────────
        // Apply the same Number.isFinite + >0 guard and DEFAULT_TIMEOUT_MS
        // fallback used by the heuristic path so a bad/missing timeout_ms
        // falls through to the driver default instead of being passed raw.
        const sdInputTimeoutMs =
          typeof input.timeout_ms === "number" &&
          Number.isFinite(input.timeout_ms) &&
          input.timeout_ms > 0
            ? input.timeout_ms
            : NaN;
        const sdTimeoutMs = Number.isFinite(sdInputTimeoutMs)
          ? sdInputTimeoutMs
          : (depTimeoutMs ?? DEFAULT_TIMEOUT_MS);

        // ── F6: Wall-clock abort controller for the spec-driven runner ──────
        // Mirrors the heuristic path: set a hard wall-clock cap so a hung
        // runner is bounded, and thread ctx.abortSignal so external drains
        // also cancel the runner.
        const sdAbort = new AbortController();
        let sdTimedOut = false;
        const sdTimeoutHandle = setTimeout(() => {
          sdTimedOut = true;
          sdAbort.abort();
        }, sdTimeoutMs);
        const sdExternalAbort = ctx.abortSignal;
        const onSdExternalAbort = (): void => {
          sdAbort.abort();
        };
        if (sdExternalAbort) {
          if (sdExternalAbort.aborted) sdAbort.abort();
          else
            sdExternalAbort.addEventListener("abort", onSdExternalAbort, {
              once: true,
            });
        }

        // rowPrefix is always "d6" in the spec-driven branch (the "d5" guard is
        // at the outer if above), but resolve it for emitAggregate consistency.
        const sdRowPrefix = input.rowPrefix ?? "d6";

        try {
          // Resolve the integration directory: showcase/integrations/<slug>.
          // Mirrors the same resolution used by registerE2eCommand in cli/e2e.ts.
          const showcaseDir =
            ctx.env["SHOWCASE_DIR"] ??
            process.env["SHOWCASE_DIR"] ??
            path.join(process.cwd(), "showcase");
          const integrationDir = path.join(showcaseDir, "integrations", slug);

          // ── F7: Wrap dynamic import failure in a caught path ──────────────
          // A throw from the dynamic import (or from resolving the runner)
          // propagates out of run() with no aggregate → stale dashboard row.
          // Catch here and emit a RED aggregate instead (mirrors how the
          // heuristic path converts launcher errors to red).
          //
          // R2.4: The import resolver is injectable (specDrivenImportResolver)
          // so tests can force a real import-path failure without a missing
          // module on disk, giving the catch block earned coverage.
          let runner: NonNullable<typeof specDrivenRunner>;
          try {
            runner =
              specDrivenRunner ??
              (await specDrivenImportResolver("../../cli/e2e.js").then(
                (m) =>
                  (
                    m as {
                      runSpecDrivenD6: NonNullable<typeof specDrivenRunner>;
                    }
                  ).runSpecDrivenD6,
              ));
          } catch (importErr) {
            const msg =
              importErr instanceof Error
                ? importErr.message
                : String(importErr);
            ctx.logger.warn("probe.e2e-full.spec-driven-import-error", {
              slug,
              err: msg,
            });
            const importErrAggregate: ProbeResult<E2eFullAggregateSignal> = {
              key: input.key,
              state: "red",
              signal: {
                shape: "package",
                slug,
                backendUrl,
                // R2.2: total is 0 here because no runner was resolved and no
                // verdicts were produced — there is no expected-cell count
                // derivable at this point (the spec manifest hasn't been read).
                total: 0,
                passed: 0,
                failed: [],
                skipped: [],
                errorDesc: "spec-driven-import-error",
                failureSummary: msg,
              },
              observedAt,
            };
            // F1: Always emit the aggregate so the dashboard row is never stale.
            await emitAggregate(ctx, slug, importErrAggregate, sdRowPrefix);
            return importErrAggregate;
          }

          // ── F7 (cont.) + F8: Pass notSupportedFeatures per contract ─────
          // Also catch runner CALL failures — a runner that throws after
          // the import resolved (e.g. a injected stub that throws) still
          // must NOT escape run() without an aggregate emit.
          let sdResult: Awaited<ReturnType<typeof runner>>;
          try {
            sdResult = await runner(slug, {
              backendUrl,
              integrationDir,
              timeoutMs: sdTimeoutMs,
              notSupportedFeatures: input.notSupportedFeatures,
              signal: sdAbort.signal,
              ctx,
            });
          } catch (runnerCallErr) {
            const msg =
              runnerCallErr instanceof Error
                ? runnerCallErr.message
                : String(runnerCallErr);
            ctx.logger.warn("probe.e2e-full.spec-driven-runner-error", {
              slug,
              err: msg,
            });
            const runnerErrAggregate: ProbeResult<E2eFullAggregateSignal> = {
              key: input.key,
              state: "red",
              signal: {
                shape: "package",
                slug,
                backendUrl,
                // R2.2: total is 0 here because the runner threw before
                // returning any verdicts or counters — no cell count is
                // derivable (the runner never completed its manifest scan).
                total: 0,
                passed: 0,
                failed: [],
                skipped: [],
                errorDesc: "spec-driven-runner-error",
                failureSummary: msg,
              },
              observedAt,
            };
            // F1: Always emit the aggregate so the dashboard row is never stale.
            await emitAggregate(ctx, slug, runnerErrAggregate, sdRowPrefix);
            return runnerErrAggregate;
          }

          // ── R2.1: Wall-clock timeout forces red aggregate ─────────────────
          // If sdTimedOut is true the runner's abort signal was already fired.
          // The runner may have returned partial all-green verdicts for the
          // cells it completed before aborting — those must NOT yield a GREEN
          // aggregate. Mirror the heuristic path's abort semantics: treat a
          // timed-out run as unconditionally red with a "timeout" errorClass
          // regardless of the returned verdicts.
          if (sdTimedOut) {
            const completedCount = sdResult.verdicts.size;
            ctx.logger.warn("probe.e2e-full.spec-driven-timeout", {
              slug,
              completedCount,
            });
            // R5-K2: Carry actual known counts from the runner's verdict map so
            // the timeout aggregate is machine-readable (a red slug's progress is
            // visible to monitors). Partition the partial verdicts into
            // passed/failed[]/skipped[] so the SUM INVARIANT holds.
            let sdTimedOutPassed = 0;
            const sdTimedOutFailed: string[] = [];
            const sdTimedOutSkipped: string[] = [];
            for (const [cell, verdict] of sdResult.verdicts) {
              if (verdict === "GREEN") sdTimedOutPassed++;
              else if (verdict === "SKIPPED") sdTimedOutSkipped.push(cell);
              else sdTimedOutFailed.push(cell);
            }
            // R7-M1: state/failed[]-same-reduction invariant. A timeout exit
            // is unconditionally red. If all completed cells were GREEN/SKIPPED,
            // failed[] would be empty — violating the invariant that state=red
            // implies failed.length > 0. Inject a sentinel for the un-run cells
            // (those not yet returned before abort) so the invariant holds. The
            // sentinel is distinguishable from real cell names in diagnostics.
            // Total grows by 1 to account for the sentinel so the sum invariant
            // (passed+failed+skipped===total) is preserved.
            let sdTimedOutTotal = completedCount;
            if (sdTimedOutFailed.length === 0) {
              sdTimedOutFailed.push("<unrun-by-timeout>");
              sdTimedOutTotal += 1;
            }
            const timeoutAggregate: ProbeResult<E2eFullAggregateSignal> = {
              key: input.key,
              state: "red",
              signal: {
                shape: "package",
                slug,
                backendUrl,
                // SUM INVARIANT: passed+failed+skipped === total.
                total: sdTimedOutTotal,
                passed: sdTimedOutPassed,
                failed: sdTimedOutFailed,
                skipped: sdTimedOutSkipped,
                incapable: computeSdIncapable(
                  sdTimedOutSkipped,
                  input.notSupportedFeatures,
                ),
                errorDesc: "timeout",
                note: `spec-driven: wall-clock timeout (${sdTimeoutMs}ms) — ${completedCount} cells returned before abort`,
              },
              observedAt,
            };
            await emitAggregate(ctx, slug, timeoutAggregate, sdRowPrefix);
            return timeoutAggregate;
          }

          // ── H1: External drain abort forces non-green aggregate ───────────
          // When ctx.abortSignal fired (external drain/redeploy) AND the
          // wall-clock timer did NOT fire (sdTimedOut is false), the runner
          // received sdAbort via the external chain and may have returned
          // partial all-green verdicts. Those must NOT produce a GREEN
          // aggregate — a drained run is not a passing run. Mirror the
          // heuristic path's drainReason==="shutdown" semantics: emit a
          // drain-suppressed outcome so the dashboard row stays neutral
          // (not mass-red, not false-green). The errorClass "drain" matches
          // the heuristic path's drain-suppressed intent.
          const sdExternalDrained =
            sdExternalAbort?.aborted === true && !sdTimedOut;
          if (sdExternalDrained) {
            const completedCount = sdResult.verdicts.size;
            ctx.logger.warn("probe.e2e-full.spec-driven-drain", {
              slug,
              completedCount,
            });
            // R5-K2: Carry actual known counts from the runner's verdict map so
            // the drain aggregate is machine-readable. Partition partial verdicts
            // so the SUM INVARIANT holds.
            let sdDrainPassed = 0;
            const sdDrainFailed: string[] = [];
            const sdDrainSkipped: string[] = [];
            for (const [cell, verdict] of sdResult.verdicts) {
              if (verdict === "GREEN") sdDrainPassed++;
              else if (verdict === "SKIPPED") sdDrainSkipped.push(cell);
              else sdDrainFailed.push(cell);
            }
            // R7-M1: state/failed[]-same-reduction invariant. A drain exit is
            // unconditionally red. If all completed cells were GREEN/SKIPPED,
            // failed[] would be empty — violating the invariant that state=red
            // implies failed.length > 0. Inject a sentinel for the un-run cells
            // so the invariant holds. Total grows by 1 to preserve the sum
            // invariant (passed+failed+skipped===total).
            let sdDrainTotal = completedCount;
            if (sdDrainFailed.length === 0) {
              sdDrainFailed.push("<unrun-by-drain>");
              sdDrainTotal += 1;
            }
            const drainAggregate: ProbeResult<E2eFullAggregateSignal> = {
              key: input.key,
              state: "red",
              signal: {
                shape: "package",
                slug,
                backendUrl,
                // SUM INVARIANT: passed+failed+skipped === total.
                total: sdDrainTotal,
                passed: sdDrainPassed,
                failed: sdDrainFailed,
                skipped: sdDrainSkipped,
                incapable: computeSdIncapable(
                  sdDrainSkipped,
                  input.notSupportedFeatures,
                ),
                errorDesc: "drain",
                note: `spec-driven: external abort (drain/redeploy) — ${completedCount} cells returned before abort; aggregate suppressed`,
              },
              observedAt,
            };
            await emitAggregate(ctx, slug, drainAggregate, sdRowPrefix);
            return drainAggregate;
          }

          // ── F3: Empty verdict map must be red/UNKNOWN, never green ────────
          if (sdResult.verdicts.size === 0) {
            // R2.2: total derives from the runner counters when the verdict
            // map is empty but the runner counters are non-zero (the runner
            // completed its scan but produced no verdicts — e.g. every cell
            // was filtered out). If the counters are also zero the total is
            // genuinely 0 (no cells registered in the manifest).
            const derivedTotal =
              sdResult.greenCount +
              sdResult.cellsFailed +
              sdResult.skippedCount;
            // J2-fix-2 SUM INVARIANT: passed+failed+skipped must === total.
            // With no verdicts returned, there are no cell names to partition
            // by category. Treat all derivedTotal slots as failed so the
            // invariant holds and the aggregate is correctly red. The failed[]
            // entries use a synthetic sentinel so they are distinguishable from
            // real cell names in diagnostics.
            const emptyFailed: string[] =
              derivedTotal > 0
                ? Array.from(
                    { length: derivedTotal },
                    (_, i) => `<unknown-cell-${i}>`,
                  )
                : [];
            const emptyAggregate: ProbeResult<E2eFullAggregateSignal> = {
              key: input.key,
              state: "red",
              signal: {
                shape: "package",
                slug,
                backendUrl,
                total: derivedTotal,
                passed: 0,
                // J2-fix-2: populate failed[] so sum invariant holds.
                failed: emptyFailed,
                skipped: [],
                // J2-fix-2: greppable errorDesc mirrors sibling red exits.
                errorDesc: "spec-driven-empty-verdicts",
                note: "spec-driven: no verdicts produced — treating as UNKNOWN (red)",
              },
              observedAt,
            };
            // F1: Always emit the aggregate.
            await emitAggregate(ctx, slug, emptyAggregate, sdRowPrefix);
            return emptyAggregate;
          }

          // ── F2 + F4: Derive state AND failed[] from the SAME exhaustive
          // verdict reduction. UNKNOWN counts as failed. Unrecognized values
          // fall to the fail-closed default (treated as failed) so no verdict
          // can silently drop. This guarantees state and failed[] can never
          // disagree.
          const sdFailed: string[] = [];
          const sdSkipped: string[] = [];
          let sdPassed = 0;
          for (const [cell, verdict] of sdResult.verdicts) {
            if (verdict === "GREEN") {
              sdPassed++;
            } else if (verdict === "SKIPPED") {
              sdSkipped.push(cell);
            } else {
              // RED, UNKNOWN, or any unrecognized value → fail-closed (red).
              sdFailed.push(cell);
            }
          }

          // ── R2.3: Reconcile verdict-reduction counts vs runner counters ────
          // The runner owns its own greenCount/failedCount/skippedCount. If
          // those disagree per-category with the verdict reduction it means the
          // runner returned a partial or inconsistent verdict map (it registered
          // more cells than it produced verdicts for, or misclassified them —
          // silently dropping cells). Treat any per-category disagreement as an
          // inconsistency and fail-closed: emit red with a diagnostic so the
          // dashboard doesn't show a false-green for a partial run.
          //
          // Per-category (not just total): a runner that, say, inflates
          // greenCount by moving failures into green while total matches would
          // still trigger a false-green if only totals were compared. Per-
          // category catches any category-level drift.
          const sdReducedTotal = sdPassed + sdFailed.length + sdSkipped.length;
          const sdRunnerTotal =
            sdResult.greenCount + sdResult.cellsFailed + sdResult.skippedCount;
          const sdCategoryMismatch =
            sdRunnerTotal > 0 &&
            (sdResult.greenCount !== sdPassed ||
              sdResult.cellsFailed !== sdFailed.length ||
              sdResult.skippedCount !== sdSkipped.length);
          if (sdCategoryMismatch) {
            ctx.logger.warn("probe.e2e-full.spec-driven-count-mismatch", {
              slug,
              reducedTotal: sdReducedTotal,
              runnerTotal: sdRunnerTotal,
              reducedGreen: sdPassed,
              runnerGreen: sdResult.greenCount,
              reducedFailed: sdFailed.length,
              runnerFailed: sdResult.cellsFailed,
              reducedSkipped: sdSkipped.length,
              runnerSkipped: sdResult.skippedCount,
            });
            const mismatchAggregate: ProbeResult<E2eFullAggregateSignal> = {
              key: input.key,
              state: "red",
              signal: {
                shape: "package",
                slug,
                backendUrl,
                // SUM INVARIANT: use the verdict-reduction counts (which ARE
                // internally consistent by construction) so that
                // passed+failed+skipped===total. The runner's claimed counters
                // (which disagree) are preserved in the note for diagnostics.
                total: sdReducedTotal,
                passed: sdPassed,
                failed: sdFailed,
                skipped: sdSkipped,
                incapable: computeSdIncapable(
                  sdSkipped,
                  input.notSupportedFeatures,
                ),
                errorDesc: "spec-driven-count-mismatch",
                note: `spec-driven: per-category mismatch — runner(green=${sdResult.greenCount},failed=${sdResult.cellsFailed},skipped=${sdResult.skippedCount}) vs reduction(green=${sdPassed},failed=${sdFailed.length},skipped=${sdSkipped.length}) — partial verdict map, treating as fail-closed`,
              },
              observedAt,
            };
            await emitAggregate(ctx, slug, mismatchAggregate, sdRowPrefix);
            return mismatchAggregate;
          }

          const sdAggregateState = sdFailed.length === 0 ? "green" : "red";

          // J2-fix-1: Derive incapable[] from the intersection of sdSkipped
          // and input.notSupportedFeatures so architectural NSF skips are
          // distinguishable from operational skips in the spec-driven path,
          // mirroring the heuristic path (~line 1985-88). Uses the shared
          // computeSdIncapable helper (also applied at timeout/drain/mismatch
          // exits) so the "incapable ⊆ skipped" contract holds on every exit.
          const sdIncapable = computeSdIncapable(
            sdSkipped,
            input.notSupportedFeatures,
          );

          // Return a synthetic aggregate result shaped identically to the
          // heuristic path so callers (fleet worker, tests) see no difference.
          const sdAggregateResult: ProbeResult<E2eFullAggregateSignal> = {
            key: input.key,
            state: sdAggregateState,
            signal: {
              shape: "package",
              slug,
              backendUrl,
              total: sdResult.verdicts.size,
              passed: sdPassed,
              failed: sdFailed,
              skipped: sdSkipped,
              incapable: sdIncapable,
            },
            observedAt,
          };
          // F1: Always emit the aggregate on every exit of the spec-driven
          // branch — mirrors the heuristic path so the dashboard d6:<slug> row
          // is always updated even when the run fails.
          await emitAggregate(ctx, slug, sdAggregateResult, sdRowPrefix);
          return sdAggregateResult;
        } finally {
          clearTimeout(sdTimeoutHandle);
          if (sdExternalAbort) {
            sdExternalAbort.removeEventListener("abort", onSdExternalAbort);
          }
          // sdTimedOut is now consumed above in the R2.1 timeout check.
        }
      }
      // ── End spec-driven branch ────────────────────────────────────────────

      // Resolve the outer-cap per `run()`. Fleet path: the enumerator conveys
      // the YAML cap in `input.timeout_ms` (the worker never runs the in-process
      // `probe-invoker` boot path that applies `cfg.timeout_ms`). Validated by
      // the schema (positive int), but guard defensively here too so a bad value
      // falls through to the dep/default rather than silently disabling the cap.
      // Resolution order: input cap → construction dep → hardcoded default.
      const inputTimeoutMs =
        typeof input.timeout_ms === "number" &&
        Number.isFinite(input.timeout_ms) &&
        input.timeout_ms > 0
          ? input.timeout_ms
          : NaN;
      const timeoutMs = Number.isFinite(inputTimeoutMs)
        ? inputTimeoutMs
        : (depTimeoutMs ?? DEFAULT_TIMEOUT_MS);

      // Dashboard row-key prefix. Defaults to "d6"; the D5 probe passes
      // "d5" so its dashboard column reads the same run conditions.
      const rowPrefix = input.rowPrefix ?? "d6";

      // CVDIAG: mint one correlation id per feature-run invocation. Threaded
      // into the browser context as `x-diag-run-id` (alongside the
      // `x-aimock-context` slug we already inject) and used to filter the
      // post-run aimock journal so this run's hops are reconstructable. The
      // component tag distinguishes the D5 take-one path from a full D6 run
      // even though they share THIS driver — that distinction is the whole
      // point of the CV incident (D5/CV red while D6 green).
      const runId = idFactory();
      const cvComponent = rowPrefix === "d5" ? "harness-d5" : "harness-d6";
      // The aimock base URL the framework apps are wired to send X-AIMock-*
      // against. Read from env (orchestrator sets AIMOCK_URL; the CLI sets
      // AIMOCK_URL_LOCAL) rather than hardcoded — same source the wiring
      // probe matches against. Used for the best-effort post-run journal
      // join; absent → the join is skipped (logged as status=error).
      const aimockBaseUrl = ctx.env.AIMOCK_URL ?? ctx.env.AIMOCK_URL_LOCAL;

      // CVDIAG probe-session emitter (spec §3 Layer 1). Injected for tests;
      // otherwise constructed once per `run()` from the probe's env so the
      // resolved verbosity tier honors CVDIAG_VERBOSE / CVDIAG_DEBUG. The PB
      // writer (when wired) makes the queued probe-layer events PERSIST to
      // `cvdiag_events` on the run-level flush below. Construction is wrapped so
      // a fail-closed DEBUG guard throw can never break the probe — CVDIAG is
      // pure instrumentation. This is the SAME session the d4 driver
      // constructs (extracted to `cvdiag/probe-session.ts`); the d5/d6 path was
      // previously the ONLY probe family that did NOT emit these boundaries,
      // which is exactly why the flapping d5/d6 runs were unreadable from
      // `cvdiag_events`.
      let cvdiagEmitter: CvdiagEmitter | undefined = deps.cvdiagEmitter;
      if (cvdiagEmitter === undefined) {
        try {
          cvdiagEmitter = new CvdiagEmitter({
            env: ctx.env,
            layer: "probe",
            pbWriter: cvdiagPbWriter,
          });
        } catch (err) {
          ctx.logger.warn("probe.e2e-full.cvdiag-init-failed", {
            slug,
            err: err instanceof Error ? err.message : String(err),
          });
          cvdiagEmitter = undefined;
        }
      }

      // Resolve the feature list. ALL features, not one-per-type.
      const featuresFromInput = input.features ?? [];
      const featureSource: readonly string[] =
        featuresFromInput.length > 0
          ? featuresFromInput
          : demosToFeatureTypes(input.demos ?? []);

      let requestedFeatures = featureSource.filter(isKnownFeatureType);

      // D5-take-one scoping: when representativeOnly is set, narrow the
      // matrix to ONLY the featureTypes that have a configured representative
      // in the representatives map. This is what makes the D5 probe a
      // single-representative-pill invocation of THIS driver — everything
      // else (route, headers, conversation, pooled launcher) is byte-
      // identical to a full D6 run.
      if (input.representativeOnly) {
        requestedFeatures = requestedFeatures.filter(
          (ft) => representatives[ft] !== undefined,
        );
      }

      // NSF reclassification: features the integration's manifest
      // declares in `not_supported_features` are architecturally
      // incapable on this framework. Partition them out BEFORE script
      // resolution / runnable filtering so they're never attempted —
      // a stub demo page would fail every assertion and report red,
      // but the framework gap is the cause, not a regression. Emit
      // them as green side-rows with `errorClass: "skipped-incapable"`
      // and surface in the aggregate via `incapable[]` (a subset of
      // `skipped[]`).
      const incapableSet = new Set<string>(input.notSupportedFeatures ?? []);
      const incapableFeatures: D5FeatureType[] = [];
      const capableRequestedFeatures: D5FeatureType[] = [];
      for (const ft of requestedFeatures) {
        if (incapableSet.has(ft)) {
          incapableFeatures.push(ft);
        } else {
          capableRequestedFeatures.push(ft);
        }
      }

      if (requestedFeatures.length === 0) {
        const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
          key: input.key,
          state: "green",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            total: 0,
            passed: 0,
            failed: [],
            skipped: [],
            note: "no D5 features declared",
          },
          observedAt,
        };
        await emitAggregate(ctx, slug, aggregateResult, rowPrefix);
        return aggregateResult;
      }

      // Deploy-churn grace window
      if (input.deployedAt && input.deployedAt.length > 0) {
        const deployedAtMs = Date.parse(input.deployedAt);
        if (Number.isFinite(deployedAtMs)) {
          const ageMs = ctx.now().getTime() - deployedAtMs;
          if (ageMs >= 0 && ageMs < DEPLOY_CHURN_GRACE_MS) {
            const ageSec = Math.round(ageMs / 1000);
            const graceSec = Math.round(DEPLOY_CHURN_GRACE_MS / 1000);
            const skipNote = `skipped: deploy in progress (${ageSec}s ago)`;
            ctx.logger.info("probe.e2e-full.deploy-churn-skip", {
              slug,
              deployedAt: input.deployedAt,
              ageMs,
              graceMs: DEPLOY_CHURN_GRACE_MS,
            });

            for (const ft of requestedFeatures) {
              await sideEmit(ctx, {
                key: `${rowPrefix}:${slug}/${ft}`,
                state: "green",
                signal: {
                  slug,
                  featureType: ft,
                  backendUrl,
                  note: skipNote,
                },
                observedAt: ctx.now().toISOString(),
              });
            }

            const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
              key: input.key,
              state: "green",
              signal: {
                shape: "package",
                slug,
                backendUrl,
                total: requestedFeatures.length,
                passed: 0,
                failed: [],
                skipped: requestedFeatures.map(String),
                note: `deploy-churn skip: deployed ${ageSec}s ago (grace: ${graceSec}s)`,
              },
              observedAt,
            };
            await emitAggregate(ctx, slug, aggregateResult, rowPrefix);
            return aggregateResult;
          }
        }
      }

      // Populate the D5 script registry.
      try {
        await scriptLoader(ctx);
      } catch (err) {
        ctx.logger.warn("probe.e2e-full.script-loader-failed", {
          slug,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      const serviceStart = Date.now();
      ctx.logger.info("probe.e2e-full.service-start", {
        slug,
        featureCount: requestedFeatures.length,
        backendUrl,
      });

      // D6 strict missing-script handling: features without a registered
      // script FAIL with red (unlike D5 which skips with green). Missing
      // scripts in D6 are coverage gaps that must surface immediately.
      // Incapable features (NSF) are excluded from this check entirely
      // — they're emitted as green side-rows below.
      const missingScript: string[] = [];
      let runnable: D5FeatureType[] = [];
      for (const ft of capableRequestedFeatures) {
        if (D5_REGISTRY.has(ft)) {
          runnable.push(ft);
        } else {
          missingScript.push(ft);
        }
      }

      // Apply feature-type filter from the trigger layer.
      const filteredByTrigger: string[] = [];
      if (ctx.featureTypes?.length) {
        const allowed = new Set(ctx.featureTypes);
        const kept: D5FeatureType[] = [];
        for (const ft of runnable) {
          if (allowed.has(ft)) {
            kept.push(ft);
          } else {
            filteredByTrigger.push(ft);
          }
        }
        if (filteredByTrigger.length > 0) {
          ctx.logger.info("probe.e2e-full.feature-type-filter-applied", {
            featureTypes: ctx.featureTypes,
            filteredOut: filteredByTrigger.length,
          });
        }
        runnable = kept;
      }

      // Hard-timeout + abort plumbing
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
        if (externalAbort.aborted) abort.abort();
        else
          externalAbort.addEventListener("abort", onExternalAbort, {
            once: true,
          });
      }

      let browser: E2eFullBrowser | undefined;
      try {
        try {
          browser = await launcher(abort.signal);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn("probe.e2e-full.launcher-error", { slug, err: msg });
          const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
            key: input.key,
            state: "red",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              total: requestedFeatures.length,
              passed: 0,
              failed: [],
              skipped: incapableFeatures.map(String),
              incapable:
                incapableFeatures.length > 0
                  ? incapableFeatures.map(String)
                  : undefined,
              errorDesc: "launcher-error",
              failureSummary: truncateUtf8(msg, 1200),
            },
            observedAt,
          };
          await emitAggregate(ctx, slug, aggregateResult, rowPrefix);
          return aggregateResult;
        }

        // Emit red side rows for missing-script features upfront.
        for (const ft of missingScript) {
          await sideEmit(ctx, {
            key: `${rowPrefix}:${slug}/${ft}`,
            state: "red",
            signal: {
              slug,
              featureType: ft,
              backendUrl,
              errorClass: "missing-script",
              errorDesc: `no script registered for featureType "${ft}"`,
            },
            observedAt: ctx.now().toISOString(),
          });
        }

        // Emit green side rows for filtered-by-trigger features.
        for (const ft of filteredByTrigger) {
          await sideEmit(ctx, {
            key: `${rowPrefix}:${slug}/${ft}`,
            state: "green",
            signal: {
              slug,
              featureType: ft,
              backendUrl,
              note: "filtered-by-trigger",
            },
            observedAt: ctx.now().toISOString(),
          });
        }

        // Emit green side rows for NSF-incapable features. Distinct
        // `errorClass: "skipped-incapable"` so log scrapers can
        // distinguish manifest-declared framework gaps from operational
        // skips. State is green so the dashboard does NOT count these
        // as red, but the side-row carries the reason for auditability.
        for (const ft of incapableFeatures) {
          await sideEmit(ctx, {
            key: `${rowPrefix}:${slug}/${ft}`,
            state: "green",
            signal: {
              slug,
              featureType: ft,
              backendUrl,
              errorClass: "skipped-incapable",
              note: "skipped: not supported by integration (manifest.not_supported_features)",
            },
            observedAt: ctx.now().toISOString(),
          });
        }

        // If nothing is runnable but we have missing scripts, that's a red.
        if (runnable.length === 0 && missingScript.length > 0) {
          const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
            key: input.key,
            state: "red",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              total: requestedFeatures.length,
              passed: 0,
              failed: missingScript,
              skipped: [...filteredByTrigger, ...incapableFeatures],
              incapable:
                incapableFeatures.length > 0
                  ? incapableFeatures.map(String)
                  : undefined,
              failureSummary: missingScript
                .map((ft) => `${ft}: no script registered`)
                .join("; "),
            },
            observedAt,
          };
          await emitAggregate(ctx, slug, aggregateResult, rowPrefix);
          return aggregateResult;
        }

        // If nothing is runnable and everything was filtered, green.
        if (runnable.length === 0) {
          const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
            key: input.key,
            state: "green",
            signal: {
              shape: "package",
              slug,
              backendUrl,
              total: requestedFeatures.length,
              passed: 0,
              failed: [],
              skipped: [...filteredByTrigger, ...incapableFeatures],
              incapable:
                incapableFeatures.length > 0
                  ? incapableFeatures.map(String)
                  : undefined,
              note:
                filteredByTrigger.length > 0
                  ? "all runnable features filtered by trigger"
                  : "all requested features are NSF-incapable",
            },
            observedAt,
          };
          await emitAggregate(ctx, slug, aggregateResult, rowPrefix);
          return aggregateResult;
        }

        // Run features with bounded parallelism.
        const sem = new Semaphore(FEATURE_CONCURRENCY_D6);
        const browserRef: E2eFullBrowser = browser!;

        const featurePromises = runnable.map(async (ft) => {
          const sideKey = `${rowPrefix}:${slug}/${ft}`;
          const script = D5_REGISTRY.get(ft)!;
          const route = (script.preNavigateRoute ?? defaultRoute)(ft, {
            demos: input.demos,
          });
          const url = `${backendUrl}${route}`;

          await sem.acquire();
          const featureStart = Date.now();
          // In-flight runFeature promises that may still be holding a
          // pooled BrowserContext after the Promise.race resolves. On
          // the feature-timeout path the race resolves a synthetic
          // result while the real runFeature keeps running until its
          // abort-driven teardown closes the context (→ pool.release).
          // We gate sem.release() (outer finally) on these settling so
          // the freed slot can't be re-acquired while an orphan still
          // holds a context, which would push live pooled contexts past
          // the FEATURE_CONCURRENCY-bounded budget.
          const inFlightRunFeatures: Array<
            Promise<Awaited<ReturnType<typeof runFeature>>>
          > = [];
          try {
            if (abort.signal.aborted) {
              // GRACEFUL DRAIN (FIX 3): when the abort is a worker drain —
              // `ctx.drainReason === "shutdown"` AND the EXTERNAL drain signal
              // actually FIRED — SUPPRESS the red per-cell side-emit for this
              // not-yet-started pill; a redeploy must not paint a mass-red
              // block. The pill keeps its prior dashboard colour; the
              // worker-loop layer separately abandons the partial (skips
              // `queue.report`) so the lease lapses into the sweeper's
              // neutral-gray re-queue. The internal `abort` controller ALSO
              // fires on the driver's own wall-clock `timeoutMs` cap, so the
              // drain reason alone is not proof of a drain — require
              // `ctx.abortSignal.aborted` too. A timeout/error abort still
              // emits red so a genuine failure stays visible.
              const drainAborted =
                ctx.drainReason === "shutdown" &&
                ctx.abortSignal?.aborted === true;
              if (!drainAborted) {
                await sideEmit(ctx, {
                  key: sideKey,
                  state: "red",
                  signal: {
                    slug,
                    featureType: ft,
                    backendUrl,
                    url,
                    fixtureFile: script.fixtureFile,
                    errorClass: "abort",
                    errorDesc: timedOut
                      ? `timeout after ${timeoutMs}ms`
                      : "aborted",
                  },
                  observedAt: ctx.now().toISOString(),
                });
              }
              ctx.logger.info("probe.e2e-full.feature-complete", {
                slug,
                featureType: ft,
                pass: false,
                errorDesc: timedOut
                  ? `timeout after ${timeoutMs}ms`
                  : drainAborted
                    ? "drain-suppressed"
                    : "aborted",
                durationMs: Date.now() - featureStart,
              });
              return {
                ft,
                ok: false as const,
                errorDesc: timedOut
                  ? `timeout after ${timeoutMs}ms`
                  : "aborted",
              };
            }

            const featureAbort = new AbortController();
            const onParentAbort = (): void => featureAbort.abort();
            if (abort.signal.aborted) featureAbort.abort();
            else
              abort.signal.addEventListener("abort", onParentAbort, {
                once: true,
              });

            // Retry logic — same as e2e-deep: retry once on transient
            // failures (goto-error, conversation-error) that lasted at
            // least 2s.
            const RETRY_ELIGIBLE_ERROR_CLASSES = new Set<string>([
              "goto-error",
              "conversation-error",
            ]);
            const RETRY_MIN_DURATION_MS = 2_000;
            const runOnce = async (): Promise<
              Awaited<ReturnType<typeof runFeature>>
            > => {
              let featureTimer: ReturnType<typeof setTimeout> | undefined;
              // Per-attempt child controller. It aborts when the parent
              // (`featureAbort`) fires OR when THIS attempt's timer wins,
              // so aborting one attempt never poisons the next — the
              // retry attempt gets a fresh, un-aborted signal. Without
              // this, a single shared controller aborted by attempt 1
              // would make attempt 2's runFeature return immediately with
              // `aborted before start` (a silent no-op retry).
              const attemptAbort = new AbortController();
              const onParentAbortChild = (): void => attemptAbort.abort();
              if (featureAbort.signal.aborted) attemptAbort.abort();
              else
                featureAbort.signal.addEventListener(
                  "abort",
                  onParentAbortChild,
                  { once: true },
                );
              const runFeaturePromise = runFeature({
                browser: browserRef,
                url,
                slug,
                featureType: ft,
                pageTimeoutMs,
                script,
                buildCtx: {
                  integrationSlug: slug,
                  featureType: ft,
                  baseUrl: backendUrl,
                },
                abortSignal: attemptAbort.signal,
                logger: ctx.logger,
                // CVDIAG correlation: thread the per-run id + component tag
                // so runFeature can inject `x-diag-run-id` / `x-diag-hops`
                // alongside the `x-aimock-context` slug and emit the
                // inbound-boundary line at header injection.
                runId,
                cvComponent,
                // CVDIAG probe-session: the emitter (when present) + buffer dir
                // let runFeature construct a `CvdiagProbeSession` per feature
                // and emit the probe-layer boundaries (probe.start / navigate /
                // message.send / firstToken / exit) for THIS d5/d6 cell.
                cvdiagEmitter,
                cvdiagBufferDir,
              });
              inFlightRunFeatures.push(runFeaturePromise);
              try {
                return await Promise.race([
                  runFeaturePromise,
                  new Promise<Awaited<ReturnType<typeof runFeature>>>(
                    (resolve) => {
                      featureTimer = setTimeout(() => {
                        // Abort the parent so the launcher's open-context
                        // teardown runs; this also aborts the child via
                        // the listener above.
                        featureAbort.abort();
                        resolve({
                          ok: false,
                          errorClass: "feature-timeout",
                          errorDesc: `feature exceeded ${featureTimeoutMs}ms wall-clock`,
                        });
                      }, featureTimeoutMs);
                    },
                  ),
                ]);
              } finally {
                if (featureTimer) clearTimeout(featureTimer);
                featureAbort.signal.removeEventListener(
                  "abort",
                  onParentAbortChild,
                );
              }
            };

            let featureResult: Awaited<ReturnType<typeof runFeature>>;
            try {
              const attempt1Start = Date.now();
              featureResult = await runOnce();
              const attempt1Duration = Date.now() - attempt1Start;

              if (
                !featureResult.ok &&
                !abort.signal.aborted &&
                !featureAbort.signal.aborted &&
                featureResult.errorClass !== undefined &&
                RETRY_ELIGIBLE_ERROR_CLASSES.has(featureResult.errorClass) &&
                attempt1Duration >= RETRY_MIN_DURATION_MS
              ) {
                ctx.logger.info("probe.e2e-full.feature-retry", {
                  slug,
                  featureType: ft,
                  attempt: 1,
                  errorClass: featureResult.errorClass,
                  errorDesc: featureResult.errorDesc,
                  attempt1DurationMs: attempt1Duration,
                });
                featureResult = await runOnce();
                ctx.logger.info("probe.e2e-full.feature-retry-result", {
                  slug,
                  featureType: ft,
                  attempt: 2,
                  ok: featureResult.ok,
                  errorClass: featureResult.ok
                    ? undefined
                    : featureResult.errorClass,
                });
              }
            } finally {
              abort.signal.removeEventListener("abort", onParentAbort);
            }

            if (featureResult.ok) {
              await sideEmit(ctx, {
                key: sideKey,
                state: "green",
                signal: {
                  slug,
                  featureType: ft,
                  backendUrl,
                  url,
                  fixtureFile: script.fixtureFile,
                  turns_completed: featureResult.conversation.turns_completed,
                  total_turns: featureResult.conversation.total_turns,
                  turn_durations_ms:
                    featureResult.conversation.turn_durations_ms,
                },
                observedAt: ctx.now().toISOString(),
              });
              ctx.logger.info("probe.e2e-full.feature-complete", {
                slug,
                featureType: ft,
                pass: true,
                durationMs: Date.now() - featureStart,
              });
              // CVDIAG: post-run aimock-journal join. Best-effort; never
              // throws into the probe (own try/catch inside).
              await joinAimockJournal({
                ctx,
                diagPb,
                aimockBaseUrl,
                runId,
                slug,
                featureType: ft,
                rowPrefix,
                cvComponent,
                testId: buildE2eTestId(slug, runId),
                featureOk: true,
              });
              return { ft, ok: true as const };
            } else {
              // GRACEFUL DRAIN (FIX 3): a feature that STARTED then got aborted
              // MID-RUN by the worker drain (`errorClass: "abort"` while
              // `ctx.drainReason === "shutdown"` AND the EXTERNAL drain signal
              // actually fired) is a not-yet-completed pill — suppress its red
              // side-emit too so a redeploy doesn't paint it red. The internal
              // abort ALSO fires on the driver's own wall-clock `timeoutMs`
              // cap, so require `ctx.abortSignal.aborted` to distinguish a true
              // drain from a timeout — a timeout abort, and a genuine in-driver
              // failure (any non-abort errorClass), still paint red even within
              // the drain window.
              const drainAborted =
                ctx.drainReason === "shutdown" &&
                ctx.abortSignal?.aborted === true &&
                featureResult.errorClass === "abort";
              if (!drainAborted) {
                await sideEmit(ctx, {
                  key: sideKey,
                  state: "red",
                  signal: {
                    slug,
                    featureType: ft,
                    backendUrl,
                    url,
                    fixtureFile: script.fixtureFile,
                    turns_completed:
                      featureResult.conversation?.turns_completed,
                    total_turns: featureResult.conversation?.total_turns,
                    failure_turn: featureResult.conversation?.failure_turn,
                    turn_durations_ms:
                      featureResult.conversation?.turn_durations_ms,
                    errorDesc: featureResult.errorDesc,
                    errorClass: featureResult.errorClass,
                    diagnostics: featureResult.diagnostics,
                  },
                  observedAt: ctx.now().toISOString(),
                });
              }
              ctx.logger.info("probe.e2e-full.feature-complete", {
                slug,
                featureType: ft,
                pass: false,
                errorDesc: featureResult.errorDesc,
                durationMs: Date.now() - featureStart,
              });
              // CVDIAG: post-run aimock-journal join. On the failure path
              // this is the load-bearing case — it reveals whether the
              // x-aimock-context header actually ARRIVED at aimock (vs the
              // 503 no_fixture_match the incident shows). Best-effort.
              await joinAimockJournal({
                ctx,
                diagPb,
                aimockBaseUrl,
                runId,
                slug,
                featureType: ft,
                rowPrefix,
                cvComponent,
                testId: buildE2eTestId(slug, runId),
                featureOk: false,
                featureError: featureResult.errorDesc,
              });
              return {
                ft,
                ok: false as const,
                errorDesc: featureResult.errorDesc,
              };
            }
          } finally {
            // Gate slot release on the real teardown of any in-flight
            // runFeature. On the timeout path the synthetic verdict has
            // already been returned to the caller above; here we only
            // wait for the abandoned runFeature's context teardown (its
            // own finally → context.close() → pool.release) to settle so
            // the slot isn't handed to a new feature while an orphan
            // still holds a pooled context.
            await Promise.allSettled(inFlightRunFeatures);
            sem.release();
          }
        });

        const settled = await Promise.allSettled(featurePromises);

        // Aggregate results.
        let passed = 0;
        const failed: string[] = [...missingScript];
        const featureErrors: string[] = missingScript.map(
          (ft) => `${ft}: no script registered`,
        );
        for (let i = 0; i < settled.length; i++) {
          const outcome = settled[i]!;
          if (outcome.status === "fulfilled") {
            if (outcome.value.ok) {
              passed++;
            } else {
              failed.push(outcome.value.ft);
              if (outcome.value.errorDesc) {
                featureErrors.push(
                  `${outcome.value.ft}: ${outcome.value.errorDesc}`,
                );
              }
            }
          } else {
            const ft = runnable[i]!;
            const errMsg =
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason);
            ctx.logger.error("probe.e2e-full.feature-promise-rejected", {
              slug,
              featureType: ft,
              err: errMsg,
            });
            failed.push(ft);
            featureErrors.push(`${ft}: ${errMsg}`);
            try {
              await sideEmit(ctx, {
                key: `${rowPrefix}:${slug}/${ft}`,
                state: "red",
                signal: {
                  slug,
                  featureType: ft,
                  backendUrl,
                  errorClass: "promise-rejected",
                  errorDesc: errMsg,
                },
                observedAt: ctx.now().toISOString(),
              });
            } catch {
              // Best-effort — sideEmit already logs internally.
            }
          }
        }

        const aggregateGreen = failed.length === 0;
        ctx.logger.info("probe.e2e-full.service-complete", {
          slug,
          passed,
          failed: failed.length,
          skipped: filteredByTrigger.length + incapableFeatures.length,
          incapable: incapableFeatures.length,
          total: requestedFeatures.length,
          state: aggregateGreen ? "green" : "red",
          durationMs: Date.now() - serviceStart,
        });
        const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
          key: input.key,
          state: aggregateGreen ? "green" : "red",
          signal: {
            shape: "package",
            slug,
            backendUrl,
            total: requestedFeatures.length,
            passed,
            failed,
            skipped: [...filteredByTrigger, ...incapableFeatures],
            incapable:
              incapableFeatures.length > 0
                ? incapableFeatures.map(String)
                : undefined,
            failureSummary:
              featureErrors.length > 0 ? featureErrors.join("; ") : undefined,
          },
          observedAt,
        };
        // Unconditional dashboard-contract emit: even if features failed
        // or timed out, the dashboard's D6 column needs a `d6:<slug>` row
        // to display red (vs blank). Placed after the loop so per-feature
        // timeouts inside the loop can never skip it.
        await emitAggregate(ctx, slug, aggregateResult, rowPrefix);
        return aggregateResult;
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
          ctx.logger.warn("probe.e2e-full.cvdiag-flush-failed", {
            slug,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        if (browser) {
          try {
            await browser.close();
          } catch (err) {
            ctx.logger.warn("probe.e2e-full.browser-close-failed", {
              slug,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    },
  };
}

/**
 * Per-feature run: open a fresh browser context with D6-specific headers,
 * navigate, build turns, run the conversation. Context per feature for
 * isolation.
 */
async function runFeature(opts: {
  browser: E2eFullBrowser;
  url: string;
  slug: string;
  featureType: D5FeatureType;
  pageTimeoutMs: number;
  script: D5Script;
  buildCtx: D5BuildContext;
  abortSignal: AbortSignal;
  logger: Logger;
  /** CVDIAG per-run correlation id, injected as `x-diag-run-id`. */
  runId: string;
  /** CVDIAG component tag (`harness-d5` | `harness-d6`). */
  cvComponent: string;
  /**
   * CVDIAG probe-session emitter for THIS feature cell. Absent → no
   * probe-layer emission (instrumentation off). Same session as the d4 driver
   * (extracted to `cvdiag/probe-session.ts`).
   */
  cvdiagEmitter?: CvdiagEmitter;
  /** Replay-fallback ndjson buffer root for this cell's CVDIAG session. */
  cvdiagBufferDir?: string;
}): Promise<
  | { ok: true; conversation: ConversationResult }
  | {
      ok: false;
      errorClass: string;
      errorDesc: string;
      conversation?: ConversationResult;
      diagnostics?: Record<string, unknown>;
    }
> {
  const {
    browser,
    url,
    slug,
    featureType,
    pageTimeoutMs,
    script,
    buildCtx,
    abortSignal,
    logger,
    runId,
    cvComponent,
    cvdiagEmitter,
    cvdiagBufferDir,
  } = opts;

  const testId = buildE2eTestId(slug, runId);
  // CVDIAG probe-session for THIS feature cell (one test_id). The session
  // records `sanitizeJoinTestId(X-Test-Id)` — the SAME value the backend adopts
  // from the inbound `X-Test-Id` header (injected on the browser context below)
  // — so probe.* rows JOIN backend.* rows on `test_id`. Absent emitter → no-op.
  const cvdiag =
    cvdiagEmitter !== undefined
      ? new CvdiagProbeSession({
          emitter: cvdiagEmitter,
          testId,
          slug,
          demo: featureType,
          bufferDir: cvdiagBufferDir ?? defaultCvdiagBufferDir(),
          nowMs: nowMonoMs(),
        })
      : undefined;
  // Terminal-exit tracking: `probe.exit` fires EXACTLY ONCE per feature across
  // the success / catch / finally paths (mirrors d4's `cvdiagExited` guard).
  const cvdiagStartMs = nowMonoMs();
  let cvdiagExited = false;
  const cvdiagExit = (
    outcome: Parameters<CvdiagProbeSession["exit"]>[0],
    failureClassifier?: CvdiagFailureClassifier,
  ): void => {
    if (cvdiagExited) return;
    cvdiagExited = true;
    cvdiag?.exit(
      outcome,
      Math.round(nowMonoMs() - cvdiagStartMs),
      failureClassifier,
    );
  };

  if (abortSignal.aborted) {
    // Balance the session: emit start+exit even on the abort-before-start
    // early return so the test_id always carries an open/close pair (mirrors
    // d4). `timeout` outcome — the cell was aborted before it could run.
    cvdiag?.start(url, { width: 1280, height: 720 });
    cvdiagExit("timeout");
    return {
      ok: false,
      errorClass: "abort",
      errorDesc: "aborted before start",
    };
  }

  let context: E2eFullBrowserContext | undefined;
  let page: E2eFullPage | undefined;
  try {
    // D6 sets per-feature context headers: X-AIMock-Context and X-Test-Id.
    //
    // CVDIAG: the x-aimock-context slug is the value whose propagation the
    // CV incident traces. We additionally seed x-diag-run-id (correlation)
    // and x-diag-hops=harness (breadcrumb) on the SAME browser context so a
    // downstream hop can log the path that reached it. NOTE — this is the
    // SINGLE header-injection point for BOTH D5 and D6: D5 is "D6 take-one"
    // and runs THIS exact runFeature (there is no separate d5-single-pill.ts
    // driver; it was deleted precisely because its own launcher systematically
    // dropped x-aimock-context against the shared fleet pool). So D5 and D6
    // inject X-AIMock-Context IDENTICALLY here; any D5-vs-D6 divergence the
    // incident shows must live BELOW the browser context (env wiring / fleet
    // pool / app forwarding), not in this driver's injection.
    context = await browser.newContext({
      extraHTTPHeaders: {
        [X_AIMOCK_CONTEXT]: slug,
        "X-Test-Id": testId,
        [X_DIAG_RUN_ID]: runId,
        [X_DIAG_HOPS]: appendHop(undefined, "harness"),
      },
    });
    // CVDIAG inbound-boundary line at injection. Goes through formatCvdiag so
    // the slug is redacted to a 12-char prefix and header_present is derived.
    logger.info(
      formatCvdiag({
        component: cvComponent,
        boundary: "inbound",
        runId,
        aimockContext: slug,
        testId,
        status: "ok",
      }),
    );
    page = await context.newPage();

    logger.debug("probe.e2e-full.runFeature.navigating", {
      url,
      pageTimeoutMs,
      featureType: buildCtx.featureType,
      slug: buildCtx.integrationSlug,
    });

    // CVDIAG probe.start — record entry for THIS cell's test_id.
    cvdiag?.start(url, { width: 1280, height: 720 });

    const navStartMs = nowMonoMs();
    try {
      await page.goto(url, {
        waitUntil: "load",
        timeout: pageTimeoutMs,
      });
      logger.debug("probe.e2e-full.runFeature.navigation-complete", { url });
      // CVDIAG probe.navigate.complete — nav timing (the d6 launcher's goto
      // resolves void, so HTTP status is unavailable here → null).
      cvdiag?.navigateComplete(url, Math.round(nowMonoMs() - navStartMs), null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug("probe.e2e-full.runFeature.navigation-failed", {
        url,
        error: msg,
      });
      // CVDIAG probe.exit — a goto failure is a probe FAILURE. `surface-missing`
      // (the page never loaded → the chat surface never appeared); on an abort
      // the outcome is `timeout`.
      cvdiagExit(
        abortSignal.aborted ? "timeout" : "err",
        abortSignal.aborted ? undefined : "surface-missing",
      );
      return {
        ok: false,
        errorClass: "goto-error",
        errorDesc: truncateUtf8(msg, 1200),
      };
    }

    // Wait for React hydration
    const hydrationStart = Date.now();
    logger.debug("probe.e2e-full.runFeature.hydration-wait", {
      url,
      timeout: 15_000,
    });
    let hydrated = false;
    try {
      await page.waitForFunction(
        () => {
          const win = globalThis as unknown as {
            document: {
              querySelector(sel: string): object | null;
            };
          };
          const el = win.document.querySelector(
            '[data-testid="copilot-chat-textarea"], [data-testid="copilot-chat"] textarea, textarea',
          );
          if (!el) return false;
          return Object.getOwnPropertyNames(el).some((k) =>
            k.startsWith("__react"),
          );
        },
        { timeout: 15_000 },
      );
      hydrated = true;
      logger.debug("probe.e2e-full.runFeature.hydration-detected", {
        url,
      });
    } catch (hydrationErr) {
      logger.debug("probe.e2e-full.runFeature.hydration-timeout", { url });
      // CVDIAG: surface the previously-swallowed hydration timeout. Control
      // flow is unchanged (hydration is non-fatal; the conversation runner
      // still tries), but a silent catch hides a hop where the page never
      // came alive — which can correlate with a dropped context header
      // (no app boot → no outbound LLM call → no fixture match).
      logger.warn(
        formatCvdiag({
          component: cvComponent,
          boundary: "inbound",
          runId,
          aimockContext: slug,
          testId,
          status: "error",
          error: `hydration-timeout: ${
            hydrationErr instanceof Error
              ? hydrationErr.message.slice(0, 120)
              : String(hydrationErr).slice(0, 120)
          }`,
        }),
      );
    }
    logger.info("probe.e2e-full.runFeature.hydration-timing", {
      slug: buildCtx.integrationSlug,
      featureType: buildCtx.featureType,
      hydrated,
      hydrationMs: Date.now() - hydrationStart,
    });

    const defaultTurns = script.buildTurns(buildCtx);
    // BUBBLE_RACE_MESSAGES env override (bubble-race-repro integration
    // tests only — no-op in production). When set, replaces the demo's
    // default turn sequence with one `{ input: <string> }` per env
    // message so per-scenario test inputs flow through ONE channel
    // rather than scattering test logic across each defect commit.
    const turnsOverride = messagesOverrideFromEnv();
    const turns = turnsOverride ?? defaultTurns;
    logger.debug("probe.e2e-full.runFeature.turns-built", {
      turnCount: turns.length,
      featureType: buildCtx.featureType,
      slug: buildCtx.integrationSlug,
      bubbleRaceMessagesOverride: turnsOverride !== undefined,
    });

    // CVDIAG probe.message.send — record the first turn send with the total
    // input char count (Unicode code points across all turns). The d6 launcher
    // exposes no message-POST response seam, so edge headers are unavailable
    // here (passed undefined); the boundary still records the send.
    //
    // cvdiag instrumentation must NEVER compute-or-throw into the probe path:
    // the char count is computed ONLY when the session exists (no-op when the
    // emitter is absent), and each turn's length coerces non-string/missing
    // `input` to 0 (`[...t.input]` would throw on null/undefined/non-string,
    // which would RED an otherwise-green probe).
    if (cvdiag) {
      const totalInputChars = turns.reduce(
        (n, t) => n + (typeof t.input === "string" ? [...t.input].length : 0),
        0,
      );
      cvdiag.messageSend(0, totalInputChars);
    }

    const conversation = await runConversation(page, turns);

    if (conversation.failure_turn !== undefined) {
      logger.debug("probe.e2e-full.runFeature.conversation-failed", {
        featureType: buildCtx.featureType,
        slug: buildCtx.integrationSlug,
        failureTurn: conversation.failure_turn,
        turnsCompleted: conversation.turns_completed,
        totalTurns: conversation.total_turns,
        error: conversation.error,
      });
      const diagnostics = await captureDiagnostics(page);
      logger.warn("probe.e2e-full.runFeature.flap-diagnostics", {
        slug: buildCtx.integrationSlug,
        featureType: buildCtx.featureType,
        error: conversation.error?.slice(0, 200),
        diagnostics,
      });
      // CVDIAG: the conversation-error path is where an aimock strict 503
      // (no_fixture_match because x-aimock-context never arrived) surfaces
      // as a generic "conversation failed" turn timeout. Emit a fixture-match
      // boundary line carrying the SLUG + the real turn error so the
      // collapse no longer hides which pill failed and why. The definitive
      // header_present verdict comes from the post-run journal join.
      logger.warn(
        formatCvdiag({
          component: cvComponent,
          boundary: "fixture-match",
          runId,
          aimockContext: slug,
          testId,
          status: "miss",
          error: (
            conversation.error ?? "conversation failed without error message"
          ).slice(0, 200),
        }),
      );
      // CVDIAG probe.exit — the conversation failed. Parse the turn-runner's
      // `reason=<classifier>` breadcrumb out of `conversation.error` so the
      // probe.exit row carries the authoritative failure classifier; otherwise
      // the session derives a best-effort one from its own observed signals
      // (no SSE seam wired in d6 → typically `sse-missing`). A drain/timeout
      // abort maps to `timeout`.
      const conversationClassifier = parseFailureClassifier(conversation.error);
      cvdiagExit(
        abortSignal.aborted ? "timeout" : "err",
        abortSignal.aborted ? undefined : conversationClassifier,
      );
      return {
        ok: false,
        errorClass: "conversation-error",
        errorDesc: truncateUtf8(
          conversation.error ?? "conversation failed without error message",
          1200,
        ),
        conversation,
        diagnostics,
      };
    }

    logger.debug("probe.e2e-full.runFeature.conversation-succeeded", {
      featureType: buildCtx.featureType,
      slug: buildCtx.integrationSlug,
      turnsCompleted: conversation.turns_completed,
      turnDurations: conversation.turn_durations_ms,
    });
    // CVDIAG probe.dom.firsttoken — best-effort: the d6 path has no per-token
    // DOM seam, so approximate first-token latency from the FIRST turn's
    // wall-clock duration (the time the first assistant turn took to settle).
    // Gives the ok-path a non-null `first_token_delta_ms` and prevents the
    // derived classifier from ever labeling a green as `dom-missing`.
    const firstTurnMs = conversation.turn_durations_ms[0];
    if (firstTurnMs !== undefined) {
      cvdiag?.firstToken(cvdiagStartMs + firstTurnMs, 1);
    }
    // CVDIAG probe.exit — clean completion.
    cvdiagExit("ok");
    return { ok: true, conversation };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const diagnostics = page ? await captureDiagnostics(page) : undefined;
    // CVDIAG probe.exit (error path) — `timeout` when this attempt aborted
    // (the driver's outer / per-feature timeout fired), else `err`. A
    // `TurnNotCompleteError` carries its authoritative `reason` as the
    // classifier; otherwise the session derives one from its observed signals.
    cvdiagExit(
      abortSignal.aborted ? "timeout" : "err",
      abortSignal.aborted ? undefined : turnCompleteReason(err),
    );
    return {
      ok: false,
      errorClass: abortSignal.aborted ? "abort" : "driver-error",
      errorDesc: truncateUtf8(msg, 1200),
      diagnostics,
    };
  } finally {
    // Defense in depth: if neither the success nor the error path emitted a
    // probe.exit (an unexpected control-flow gap), emit it here so probe.exit
    // fires EXACTLY ONCE per feature on every path.
    if (!cvdiagExited) {
      cvdiagExit(abortSignal.aborted ? "timeout" : "err");
    }
    if (page) {
      try {
        await page.close();
      } catch {
        /* context.close() picks up remnants */
      }
    }
    if (context) {
      try {
        await context.close();
      } catch {
        /* browser.close() in outer finally picks up remnants */
      }
    }
  }
}

/**
 * Parse a CVDIAG failure classifier out of a conversation-runner error string.
 * `waitForTurnComplete` rejections embed a `reason=<classifier>` breadcrumb in
 * the thrown message (e.g. `turn 0 failed: reason=dom-missing — ...`). When the
 * breadcrumb names one of the canonical flap classifiers, return it so the
 * `probe.exit` row carries the authoritative reason instead of the session's
 * best-effort derivation. Returns `undefined` for any message without a
 * recognizable breadcrumb (the session then derives from its own signals).
 *
 * Validates against the shared `FAILURE_CLASSIFIER_SET` (derived from the
 * schema's canonical `CVDIAG_FAILURE_CLASSIFIERS`) — never a hand-maintained
 * subset — so a newly-added classifier (e.g. `selector-mismatch`) can never be
 * silently dropped here and mislabeled by the derived classifier.
 */
export function parseFailureClassifier(
  error: string | undefined,
): CvdiagFailureClassifier | undefined {
  if (typeof error !== "string") return undefined;
  const m = /reason=(\S+)/.exec(error);
  if (!m) return undefined;
  // Strip trailing punctuation the breadcrumb may carry (e.g. `reason=dom-missing,`).
  const reason = m[1]!.replace(/[.,;:)\]]+$/, "");
  return FAILURE_CLASSIFIER_SET.has(reason as CvdiagFailureClassifier)
    ? (reason as CvdiagFailureClassifier)
    : undefined;
}

/**
 * Best-effort browser-side diagnostic capture for failure rows. Same as
 * e2e-deep's captureDiagnostics.
 */
async function captureDiagnostics(
  page: E2eFullPage,
): Promise<Record<string, unknown> | undefined> {
  let diagnostics: Record<string, unknown> | undefined;
  if (page.isClosed?.()) {
    const browserDiag = page.getDiagnostics?.();
    if (browserDiag) {
      return {
        pageClosed: true,
        consoleLogs: browserDiag.consoleLogs,
        requestFailures: browserDiag.requestFailures,
      };
    }
    return { pageClosed: true };
  }
  // Read the assistant-message count Node-side via the shared cascade
  // BEFORE entering page.evaluate, then merge it into the diagnostics
  // object. Routing through `countAssistantMessages` here is what
  // closes defect 3 by construction — the conversation runner reads
  // its settled count via the same helper, so diagnostics and runner
  // can no longer report mismatched counts for the same frame.
  // `page.evaluate` cannot await a Node-side helper from inside the
  // browser context, so the call is hoisted out (per plan §2.2/N6).
  const assistantMsgCount = await countAssistantMessages(
    page as unknown as PlaywrightPage,
  );

  try {
    diagnostics = await page.evaluate(() => {
      type EvalElement = {
        textContent: string | null;
      };
      type EvalResourceTiming = {
        name: string;
        duration: number;
        transferSize?: number;
        responseStatus?: number;
      };
      const win = globalThis as unknown as {
        document: {
          querySelector(sel: string): unknown;
          querySelectorAll(sel: string): {
            length: number;
            [index: number]: EvalElement;
          };
          title: string;
          body?: { innerText?: string };
        };
        performance: {
          getEntriesByType(type: string): EvalResourceTiming[];
        };
        location: { href: string };
      };

      const userMsgs = win.document.querySelectorAll(
        '[data-testid="copilot-user-message"]',
      );

      const apiEntries = win.performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes("copilotkit"))
        .map((e) => ({
          url: e.name.slice(0, 200),
          duration: Math.round(e.duration),
          transferSize: e.transferSize || 0,
          status: e.responseStatus || 0,
        }));

      const errorEls = win.document.querySelectorAll(
        '[role="alert"], .error-boundary, [data-error]',
      );
      const errors: string[] = [];
      for (let i = 0; i < Math.min(errorEls.length, 3); i++) {
        errors.push((errorEls[i]!.textContent || "").slice(0, 200).trim());
      }

      const chatContainer = win.document.querySelector(
        '[data-testid="copilot-chat"]',
      );

      return {
        userMsgCount: userMsgs.length,
        apiRequestCount: apiEntries.length,
        apiRequests: apiEntries.slice(0, 5),
        pageErrors: errors,
        chatContainerExists: !!chatContainer,
        url: win.location.href,
        title: win.document.title,
        bodyTextSnippet: (win.document.body?.innerText || "")
          .slice(0, 300)
          .trim(),
      };
    });
  } catch {
    // Page may be closed or crashed — can't gather DOM diagnostics.
  }

  // Merge the shared-cascade count Node-side. Done only when the
  // browser-side evaluate succeeded so a crashed/closed page still
  // produces the same `undefined` diagnostics as before this refactor
  // — preserving the prior failure shape exactly. The browser-diag
  // merge below independently hydrates a fresh object when needed.
  if (diagnostics) {
    diagnostics.assistantMsgCount = assistantMsgCount;
  }

  const browserDiag = page.getDiagnostics?.();
  if (browserDiag) {
    if (!diagnostics) diagnostics = {};
    diagnostics.consoleLogs = browserDiag.consoleLogs;
    diagnostics.requestFailures = browserDiag.requestFailures;
  }

  return diagnostics;
}

/**
 * Minimal shape of a single aimock journal entry. The aimock
 * `GET /__aimock/journal` endpoint records each inbound request with its
 * received headers and the resolved match outcome. We read only the fields
 * the CV-verdict join needs and tolerate everything else (the endpoint may
 * carry far more). Header keys are matched case-insensitively below.
 */
interface AimockJournalEntry {
  headers?: Record<string, string>;
  status?: number;
  statusCode?: number;
  matched?: boolean;
  reason?: string;
  error?: string;
}

/** Case-insensitive header read off a journal entry's headers bag. */
function readHeaderCI(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

/**
 * CVDIAG post-run aimock-journal join. After a feature run completes, fetch
 * the aimock journal and find the entry for THIS run (matched by
 * `x-aimock-context === slug` AND `x-diag-run-id === runId`). Determine
 * whether the context header actually ARRIVED at aimock (`header_present`)
 * and the resulting status (200 vs 503 no_fixture_match). This is the
 * definitive verdict for the CV-propagation incident: a feature can fail
 * with a generic conversation-error while the journal shows the header was
 * absent at aimock — localizing the drop to a hop between this driver's
 * browser-context injection and aimock.
 *
 * Strictly best-effort: the whole body is wrapped so a journal-fetch failure
 * (endpoint missing, network error, parse error) emits a CVDIAG status=error
 * line and a swallowed `writeDiagEvent`, but NEVER throws into the probe.
 */
async function joinAimockJournal(opts: {
  ctx: ProbeContext;
  diagPb?: DiagSinkClient;
  aimockBaseUrl?: string;
  runId: string;
  slug: string;
  featureType: string;
  rowPrefix: "d5" | "d6";
  cvComponent: string;
  testId: string;
  featureOk: boolean;
  featureError?: string;
}): Promise<void> {
  const {
    ctx,
    diagPb,
    aimockBaseUrl,
    runId,
    slug,
    featureType,
    rowPrefix,
    cvComponent,
    testId,
    featureOk,
    featureError,
  } = opts;

  try {
    if (!aimockBaseUrl) {
      // No aimock base URL in env → can't join. Surface as status=error so
      // the gap is greppable; the feature verdict is unaffected.
      ctx.logger.warn(
        formatCvdiag({
          component: cvComponent,
          boundary: "cv-verdict",
          runId,
          aimockContext: slug,
          testId,
          status: "error",
          error: "aimock base url unset (AIMOCK_URL / AIMOCK_URL_LOCAL)",
        }),
      );
      return;
    }

    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
    const journalUrl = `${aimockBaseUrl.replace(/\/+$/, "")}/__aimock/journal`;
    // Bound the journal fetch: a reachable-but-hung aimock journal endpoint
    // must not stall the probe run. On timeout the fetch rejects with a
    // TimeoutError, which the surrounding catch turns into a status=error
    // CVDIAG line (pure instrumentation — never breaks the probe).
    const res = await fetchImpl(journalUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      ctx.logger.warn(
        formatCvdiag({
          component: cvComponent,
          boundary: "cv-verdict",
          runId,
          aimockContext: slug,
          testId,
          status: "error",
          error: `journal fetch ${res.status}`,
        }),
      );
      return;
    }

    const body = (await res.json()) as unknown;
    // The endpoint may return either a bare array or an `{ entries: [...] }`
    // envelope; tolerate both.
    const entries: AimockJournalEntry[] = Array.isArray(body)
      ? (body as AimockJournalEntry[])
      : Array.isArray((body as { entries?: unknown })?.entries)
        ? (body as { entries: AimockJournalEntry[] }).entries
        : [];

    // Filter to THIS run: the breadcrumb run-id must match, and the
    // aimock-context header must equal our slug. We look for the run-id match
    // first (the unambiguous correlation) and fall back to slug-only when no
    // run-id is recorded (older aimock that doesn't echo x-diag-run-id).
    const matchesRun = (e: AimockJournalEntry): boolean =>
      readHeaderCI(e.headers, X_DIAG_RUN_ID) === runId;
    const matchesSlug = (e: AimockJournalEntry): boolean =>
      readHeaderCI(e.headers, X_AIMOCK_CONTEXT) === slug;

    const runEntries = entries.filter(matchesRun);
    const slugEntries = entries.filter(matchesSlug);
    const entry =
      runEntries[runEntries.length - 1] ?? slugEntries[slugEntries.length - 1];

    if (!entry) {
      // No journal entry for this run at all — the request may never have
      // reached aimock (app didn't forward), or the journal rolled. This is
      // itself a strong CV signal: header_present=false at the verdict.
      const verdictLine = formatCvdiag({
        component: cvComponent,
        boundary: "cv-verdict",
        runId,
        // No entry → we could not confirm the header arrived. Pass undefined
        // so formatCvdiag derives header_present=false (the load-bearing
        // miss signal).
        aimockContext: undefined,
        testId,
        status: "miss",
        error: "no aimock journal entry for run",
      });
      ctx.logger.warn(verdictLine);
      if (diagPb) {
        await writeDiagEvent(diagPb, {
          run_id: runId,
          slug,
          framework: slug,
          component: cvComponent,
          boundary: "cv-verdict",
          header_present: false,
          status: "miss",
          test_id: testId,
          error: "no aimock journal entry for run",
        });
      }
      return;
    }

    const headerValue = readHeaderCI(entry.headers, X_AIMOCK_CONTEXT);
    const headerPresent = typeof headerValue === "string";
    const hops = readHeaderCI(entry.headers, X_DIAG_HOPS);
    const httpStatus = entry.status ?? entry.statusCode;
    const matched =
      entry.matched ??
      (httpStatus !== undefined ? httpStatus < 400 : undefined);
    const verdictStatus: "ok" | "miss" = matched === false ? "miss" : "ok";
    const missReason =
      verdictStatus === "miss"
        ? (entry.reason ??
          entry.error ??
          (httpStatus === 503
            ? "no_fixture_match (503)"
            : httpStatus !== undefined
              ? `status ${httpStatus}`
              : featureError))
        : undefined;

    // CVDIAG cv-verdict line: pass the RAW header value seen at aimock so the
    // formatter derives header_present from what ACTUALLY arrived (not from
    // what we injected). header_present=false here is the smoking gun.
    ctx.logger.info(
      formatCvdiag({
        component: cvComponent,
        boundary: "cv-verdict",
        runId,
        aimockContext: headerValue,
        testId,
        status: verdictStatus,
        error: missReason,
      }),
    );

    if (diagPb) {
      await writeDiagEvent(diagPb, {
        run_id: runId,
        slug,
        framework: slug,
        component: cvComponent,
        boundary: "cv-verdict",
        header_present: headerPresent,
        status: verdictStatus,
        hops,
        test_id: testId,
        error: missReason,
      });
    }

    void rowPrefix;
    void featureOk;
  } catch (err) {
    // Pure instrumentation — never let the journal join break a probe.
    ctx.logger.warn(
      formatCvdiag({
        component: cvComponent,
        boundary: "cv-verdict",
        runId,
        aimockContext: slug,
        testId,
        status: "error",
        error: `journal-join failed: ${
          err instanceof Error
            ? err.message.slice(0, 160)
            : String(err).slice(0, 160)
        }`,
      }),
    );
  }
}

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
  return raw.startsWith("showcase-") ? raw.slice("showcase-".length) : raw;
}

/** Default driver instance — registered by the orchestrator at boot. */
export const e2eFullDriver = createE2eFullDriver();
