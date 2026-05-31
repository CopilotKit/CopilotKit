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
import { runConversation } from "../helpers/conversation-runner.js";
import type {
  ConversationResult,
  Page,
} from "../helpers/conversation-runner.js";
import type { ProbeDriver } from "../types.js";
import type { Logger, ProbeContext, ProbeResult } from "../../types/index.js";
import type { BrowserPool } from "../helpers/browser-pool.js";
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
 *      and `X-Test-Id: d6-<slug>` headers, navigates to the per-feature
 *      route, and runs the conversation through `runConversation`.
 *   4. Emits one `d6:<slug>/<featureType>` diagnostic side row per
 *      feature (not consumed by dashboard rollup — diagnostic only).
 *   5. Emits an aggregate `d6:<slug>` primary result that is green ONLY
 *      if ALL features passed.
 *
 * State mapping:
 *   - green  — every feature completed with no assertion failure.
 *   - red    — any feature failed, any script missing, or launcher error.
 *
 * Reuses Semaphore, D5_REGISTRY scripts, runConversation, deploy-churn
 * grace window, and abort plumbing from e2e-deep.ts.
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
 * Minimal page surface the driver depends on. Same shape as E2eDeepPage
 * from e2e-deep.ts.
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
        const ctx = await browser.newContext({
          extraHTTPHeaders: {
            "X-AIMock-Strict": "true",
            ...contextOpts?.extraHTTPHeaders,
          },
        });
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
              goto: (u, gotoOpts) =>
                page.goto(u, gotoOpts as Parameters<typeof page.goto>[1]),
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
    const browser = await pool.acquire();

    let forceReleased = false;
    const openContexts = new Set<{ close(): Promise<void> }>();

    if (abortSignal) {
      const onAbort = (): void => {
        if (forceReleased) return;
        forceReleased = true;
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
          pool.release(browser);
          logger?.warn("probe.e2e-full.pool-abort-released", {
            closedContexts: ctxCount,
            poolAvailable: pool.stats().available,
          });
        });
      };
      if (abortSignal.aborted) {
        forceReleased = true;
        logger?.warn("probe.e2e-full.pool-pre-aborted-release");
        pool.release(browser);
      } else {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }
    }

    return {
      async newContext(contextOpts?: {
        extraHTTPHeaders?: Record<string, string>;
      }): Promise<E2eFullBrowserContext> {
        const ctx = await browser.newContext({
          extraHTTPHeaders: {
            "X-AIMock-Strict": "true",
            ...contextOpts?.extraHTTPHeaders,
          },
        });
        const ctxHandle = { close: () => ctx.close() };
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
              goto: (u, gotoOpts) =>
                page.goto(u, gotoOpts as Parameters<typeof page.goto>[1]),
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
            await ctx.close();
          },
        };
      },
      close: async () => {
        if (forceReleased) return;
        pool.release(browser);
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

export function createE2eFullDriver(
  deps: E2eFullDriverDeps = {},
): ProbeDriver<E2eFullDriverInput, E2eFullAggregateSignal> {
  const launcher = deps.launcher ?? defaultLauncher;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pageTimeoutMs = deps.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const featureTimeoutMs = deps.featureTimeoutMs ?? DEFAULT_FEATURE_TIMEOUT_MS;
  const scriptLoader = deps.scriptLoader ?? defaultScriptLoader;

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

      // Resolve the feature list. ALL features, not one-per-type.
      const featuresFromInput = input.features ?? [];
      const featureSource: readonly string[] =
        featuresFromInput.length > 0
          ? featuresFromInput
          : demosToFeatureTypes(input.demos ?? []);

      const requestedFeatures = featureSource.filter(isKnownFeatureType);

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
        await emitAggregate(ctx, slug, aggregateResult);
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
                key: `d6:${slug}/${ft}`,
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
            await emitAggregate(ctx, slug, aggregateResult);
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
              skipped: [...incapableFeatures.map(String)],
              incapable:
                incapableFeatures.length > 0
                  ? incapableFeatures.map(String)
                  : undefined,
              errorDesc: "launcher-error",
              failureSummary: truncateUtf8(msg, 1200),
            },
            observedAt,
          };
          await emitAggregate(ctx, slug, aggregateResult);
          return aggregateResult;
        }

        // Emit red side rows for missing-script features upfront.
        for (const ft of missingScript) {
          await sideEmit(ctx, {
            key: `d6:${slug}/${ft}`,
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
            key: `d6:${slug}/${ft}`,
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
            key: `d6:${slug}/${ft}`,
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
          await emitAggregate(ctx, slug, aggregateResult);
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
          await emitAggregate(ctx, slug, aggregateResult);
          return aggregateResult;
        }

        // Run features with bounded parallelism.
        const sem = new Semaphore(FEATURE_CONCURRENCY_D6);
        const browserRef: E2eFullBrowser = browser!;

        const featurePromises = runnable.map(async (ft) => {
          const sideKey = `d6:${slug}/${ft}`;
          const script = D5_REGISTRY.get(ft)!;
          const route = (script.preNavigateRoute ?? defaultRoute)(ft, {
            demos: input.demos,
          });
          const url = `${backendUrl}${route}`;

          await sem.acquire();
          const featureStart = Date.now();
          try {
            if (abort.signal.aborted) {
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
              ctx.logger.info("probe.e2e-full.feature-complete", {
                slug,
                featureType: ft,
                pass: false,
                errorDesc: timedOut
                  ? `timeout after ${timeoutMs}ms`
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
              try {
                return await Promise.race([
                  runFeature({
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
                    abortSignal: featureAbort.signal,
                    logger: ctx.logger,
                  }),
                  new Promise<Awaited<ReturnType<typeof runFeature>>>(
                    (resolve) => {
                      featureTimer = setTimeout(() => {
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
              return { ft, ok: true as const };
            } else {
              await sideEmit(ctx, {
                key: sideKey,
                state: "red",
                signal: {
                  slug,
                  featureType: ft,
                  backendUrl,
                  url,
                  fixtureFile: script.fixtureFile,
                  turns_completed: featureResult.conversation?.turns_completed,
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
              ctx.logger.info("probe.e2e-full.feature-complete", {
                slug,
                featureType: ft,
                pass: false,
                errorDesc: featureResult.errorDesc,
                durationMs: Date.now() - featureStart,
              });
              return {
                ft,
                ok: false as const,
                errorDesc: featureResult.errorDesc,
              };
            }
          } finally {
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
                key: `d6:${slug}/${ft}`,
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
        await emitAggregate(ctx, slug, aggregateResult);
        return aggregateResult;
      } finally {
        clearTimeout(timeoutHandle);
        if (externalAbort) {
          externalAbort.removeEventListener("abort", onExternalAbort);
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
    featureType: _featureType,
    pageTimeoutMs,
    script,
    buildCtx,
    abortSignal,
    logger,
  } = opts;
  if (abortSignal.aborted) {
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
    context = await browser.newContext({
      extraHTTPHeaders: {
        "X-AIMock-Context": slug,
        "X-Test-Id": `d6-${slug}`,
      },
    });
    page = await context.newPage();

    logger.debug("probe.e2e-full.runFeature.navigating", {
      url,
      pageTimeoutMs,
      featureType: buildCtx.featureType,
      slug: buildCtx.integrationSlug,
    });

    try {
      await page.goto(url, {
        waitUntil: "load",
        timeout: pageTimeoutMs,
      });
      logger.debug("probe.e2e-full.runFeature.navigation-complete", { url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug("probe.e2e-full.runFeature.navigation-failed", {
        url,
        error: msg,
      });
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
    } catch {
      logger.debug("probe.e2e-full.runFeature.hydration-timeout", { url });
    }
    logger.info("probe.e2e-full.runFeature.hydration-timing", {
      slug: buildCtx.integrationSlug,
      featureType: buildCtx.featureType,
      hydrated,
      hydrationMs: Date.now() - hydrationStart,
    });

    const turns = script.buildTurns(buildCtx);
    logger.debug("probe.e2e-full.runFeature.turns-built", {
      turnCount: turns.length,
      featureType: buildCtx.featureType,
      slug: buildCtx.integrationSlug,
    });
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
    return { ok: true, conversation };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const diagnostics = page ? await captureDiagnostics(page) : undefined;
    return {
      ok: false,
      errorClass: abortSignal.aborted ? "abort" : "driver-error",
      errorDesc: truncateUtf8(msg, 1200),
      diagnostics,
    };
  } finally {
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

      const assistantMsgs = win.document.querySelectorAll(
        '[data-testid="copilot-assistant-message"]',
      );
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
        assistantMsgCount: assistantMsgs.length,
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

  const browserDiag = page.getDiagnostics?.();
  if (browserDiag) {
    if (!diagnostics) diagnostics = {};
    diagnostics.consoleLogs = browserDiag.consoleLogs;
    diagnostics.requestFailures = browserDiag.requestFailures;
  }

  return diagnostics;
}

async function sideEmit(
  ctx: ProbeContext,
  result: ProbeResult<E2eFullFeatureSignal>,
): Promise<void> {
  if (!ctx.writer) {
    ctx.logger.warn("probe.e2e-full.writer-missing", { key: result.key });
    return;
  }
  try {
    await ctx.writer.write(result);
  } catch (err) {
    ctx.logger.error("probe.e2e-full.side-emit-writer-failed", {
      key: result.key,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Emit the integration-scoped aggregate `d6:<slug>` side row consumed
 * by the showcase dashboard. The dashboard reads this exact key (see
 * `shell-dashboard/src/lib/live-status.ts` and
 * `shell-dashboard/src/components/depth-utils.ts`). The CLI driver path
 * (cli/targets.ts -> `key: d6:<slug>`) produces this shape as its
 * primary return; the cron path's primary key is
 * `d6-all-pills-e2e:<name>`, so without this explicit side-emit the
 * dashboard's D6 column stays permanently blank.
 *
 * Best-effort and isolated from primary-return semantics: failures here
 * are logged by `ctx.writer.write` but never propagate to the caller.
 */
async function emitAggregate(
  ctx: ProbeContext,
  slug: string,
  result: ProbeResult<E2eFullAggregateSignal>,
): Promise<void> {
  if (!ctx.writer) {
    ctx.logger.warn("probe.e2e-full.aggregate-writer-missing", {
      key: `d6:${slug}`,
    });
    return;
  }
  try {
    await ctx.writer.write({
      key: `d6:${slug}`,
      state: result.state,
      signal: result.signal,
      observedAt: result.observedAt,
    });
  } catch (err) {
    ctx.logger.error("probe.e2e-full.aggregate-emit-failed", {
      key: `d6:${slug}`,
      err: err instanceof Error ? err.message : String(err),
    });
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
