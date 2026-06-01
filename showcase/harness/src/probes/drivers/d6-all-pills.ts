import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { truncateUtf8 } from "../../render/filters.js";
import { showcaseShapeSchema } from "../discovery/railway-services.js";
import type { Page } from "../helpers/conversation-runner.js";
import type { ProbeDriver } from "../types.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeState,
} from "../../types/index.js";
import type { BrowserPool } from "../helpers/browser-pool.js";
import type { SpecFileResult } from "../helpers/pw-json-reporter.js";
import { rollupCells } from "../helpers/d6-rollup.js";
import type { CellRollup } from "../helpers/d6-rollup.js";
import { declaredSkips as defaultDeclaredSkips } from "../helpers/skip-list.js";

/**
 * D6 — e2e-full ("everything works") driver (SPEC-DRIVEN).
 *
 * One driver invocation handles one showcase integration. The driver no
 * longer counts DOM nodes via the conversation-runner heuristic. Instead it
 * runs the integration's OWN Playwright e2e suite (the LGP gold suite, run
 * verbatim per integration), parses the JSON reporter output into per-spec-
 * FILE verdicts, and rolls those up FAIL-CLOSED into dashboard cells:
 *
 *   1. Invoke the integration's e2e suite via `runAndParse` (production:
 *      `runE2eAndParse` with `--retries=1`, the PRODUCTION probe path — a
 *      retried PASS counts green). Returns `SpecFileResult[]`.
 *   2. Resolve the integration's declared skips via `declaredSkips(slug)`.
 *   3. Run the PURE fail-closed rollup `rollupCells({ slug, specResults,
 *      skipped })` → one cell per mapped gold spec FILE.
 *   4. Emit one `d6:<slug>/<column>` side row per cell carrying its state.
 *   5. Emit the aggregate `d6:<slug>` row: GREEN iff every in-scope cell is
 *      green (skipped cells are neutral), RED if any cell is red, else
 *      UNKNOWN.
 *
 * FAIL-CLOSED end-to-end: a green cell requires an explicit per-spec PASS row.
 * If the e2e run errors before producing parseable results (empty
 * `specResults`, or `runAndParse` throwing), every cell is UNKNOWN and the
 * aggregate is UNKNOWN — NEVER green. There is no node-counting / settle
 * heuristic anywhere in this path.
 *
 * The conversation-runner is intentionally NOT imported here — its retirement
 * from the codebase is a later task; the D6 path simply no longer routes
 * through it.
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
 * Per-feature side-emit signal carried on each `d6:<slug>/<column>` row.
 * Diagnostic only — not consumed by dashboard rollup.
 */
export interface E2eFullFeatureSignal {
  slug: string;
  featureType: string;
  backendUrl: string;
  /**
   * The PRECISE fail-closed rollup verdict for this cell:
   * `green` | `red` | `unknown` | `skipped`. The emitted `ProbeResult.state`
   * is a fail-closed projection of this onto the narrower `ProbeState`
   * vocabulary (unknown → `error`; skipped → neutral green-side-row), but
   * `cellState` carries the unprojected truth for the dashboard rollup and
   * audit. A green `cellState` is the ONLY value that greens the cell.
   */
  cellState?: CellRollup["state"];
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
  /**
   * Counts of cells in each PRECISE rollup state. `unknown` and `skipped`
   * have no `ProbeState` equivalent; these counts let the dashboard render
   * the true breakdown even though the emitted `ProbeResult.state` projects
   * onto the narrower vocabulary.
   */
  unknown?: string[];
  /**
   * The PRECISE aggregate rollup verdict: `green` | `red` | `unknown`. The
   * emitted `ProbeResult.state` projects `unknown` → `error` (fail-closed).
   */
  aggregateState?: "green" | "red" | "unknown";
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

/**
 * Arguments handed to `runAndParse` for one integration's e2e run.
 */
export interface D6RunAndParseArgs {
  /** Integration slug, e.g. `langgraph-python`. */
  slug: string;
  /** Live integration URL the specs navigate against (BASE_URL). */
  backendUrl: string;
  /**
   * Playwright retry count. The PRODUCTION probe path passes `1` (a retried
   * PASS counts green); strict validation/CI uses `0`.
   */
  retries: number;
  /** Cancellation signal forwarded from the probe context. */
  abortSignal?: AbortSignal;
}

/**
 * Spec-driven measurement seam: run the integration's Playwright e2e suite
 * with the JSON reporter and return per-spec-FILE verdicts. The production
 * default wraps `runE2eAndParse` (cli/e2e.ts). Injected in tests so the
 * driver is exercised against scripted results without spawning Playwright.
 *
 * FAIL-CLOSED contract: an errored/empty run returns `{ specResults: [] }`
 * (or throws) — the driver maps that to all-UNKNOWN cells, never green.
 */
export type D6RunAndParse = (
  args: D6RunAndParseArgs,
) => Promise<{ specResults: SpecFileResult[] }>;

export interface E2eFullDriverDeps {
  launcher?: E2eFullBrowserLauncher;
  pageTimeoutMs?: number;
  timeoutMs?: number;
  featureTimeoutMs?: number;
  scriptLoader?: E2eFullScriptLoader;
  /**
   * Spec-driven run-and-parse. Defaults to a `runE2eAndParse` wrapper that
   * spawns the integration's Playwright suite. Tests inject a fake returning
   * scripted `SpecFileResult[]`.
   */
  runAndParse?: D6RunAndParse;
  /**
   * Resolver for an integration's declared skips. Defaults to the checked-in
   * skip-list loader (`declaredSkips`). Injected in tests to control skips
   * without touching `skip-list.json`.
   */
  declaredSkipsImpl?: (slug: string) => string[];
}

/**
 * D6 runs 4 features concurrently (vs D5's 2). Retained for the pooled
 * launcher's context budget; the spec-driven run path delegates parallelism
 * to Playwright's own `--workers`.
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
 * Production default `runAndParse`: spawn the integration's Playwright e2e
 * suite via `runE2eAndParse` (cli/e2e.ts) with the JSON reporter, resolving
 * the integration directory + a one-off `LocalConfig` from disk and supplying
 * the live `backendUrl` as the BASE_URL override (the probe path has no
 * `localPorts` mapping). Lazily imports the CLI modules so the driver module
 * doesn't pull config/`fs` at import time (and so unit tests that inject
 * `runAndParse` never load them).
 */
const defaultRunAndParse: D6RunAndParse = async ({
  slug,
  backendUrl,
  retries,
}) => {
  const [{ runE2eAndParse }, { loadConfig }] = await Promise.all([
    import("../../cli/e2e.js"),
    import("../../cli/config.js"),
  ]);
  const config = loadConfig();
  const { specResults } = runE2eAndParse(
    slug,
    { tier: "d6", retries, baseUrlOverride: backendUrl },
    config,
  );
  return { specResults };
};

export function createE2eFullDriver(
  deps: E2eFullDriverDeps = {},
): ProbeDriver<E2eFullDriverInput, E2eFullAggregateSignal> {
  const runAndParse = deps.runAndParse ?? defaultRunAndParse;
  const declaredSkipsImpl = deps.declaredSkipsImpl ?? defaultDeclaredSkips;

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

      // ---- Deploy-churn grace window -----------------------------------
      // During the grace window after a fresh deploy, the integration may
      // still be settling; running the suite would surface deploy-churn
      // false-reds. We DO NOT run the suite and DO NOT green/red the cells —
      // the aggregate is `unknown` (fail-closed: never green without a real
      // PASS) with a note so operators see why.
      if (input.deployedAt && input.deployedAt.length > 0) {
        const deployedAtMs = Date.parse(input.deployedAt);
        if (Number.isFinite(deployedAtMs)) {
          const ageMs = ctx.now().getTime() - deployedAtMs;
          if (ageMs >= 0 && ageMs < DEPLOY_CHURN_GRACE_MS) {
            const ageSec = Math.round(ageMs / 1000);
            const graceSec = Math.round(DEPLOY_CHURN_GRACE_MS / 1000);
            ctx.logger.info("probe.e2e-full.deploy-churn-skip", {
              slug,
              deployedAt: input.deployedAt,
              ageMs,
              graceMs: DEPLOY_CHURN_GRACE_MS,
            });
            // FAIL-CLOSED during deploy churn: emit `error` (the writer's
            // error branch refreshes observed_at WITHOUT mutating the
            // persisted color or fail_count — so a deploy in progress never
            // greens a cell and never trips a false red). The precise verdict
            // rides in `aggregateState: "unknown"`.
            const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
              key: input.key,
              state: "error",
              signal: {
                shape: "package",
                slug,
                backendUrl,
                total: 0,
                passed: 0,
                failed: [],
                skipped: [],
                aggregateState: "unknown",
                note: `deploy-churn skip: deployed ${ageSec}s ago (grace: ${graceSec}s)`,
              },
              observedAt,
            };
            await emitAggregate(ctx, slug, aggregateResult);
            return aggregateResult;
          }
        }
      }

      // ---- Run the integration's e2e suite + parse ----------------------
      // PRODUCTION probe path: retries=1 (a retried PASS counts green; an
      // exhausted-retry fail stays red — Playwright reflects the final
      // per-case status in the JSON the parser reads). FAIL-CLOSED: any
      // error here yields empty specResults → all-UNKNOWN cells, never green.
      const runStart = Date.now();
      let specResults: SpecFileResult[] = [];
      let runError: string | undefined;
      ctx.logger.info("probe.e2e-full.suite-start", { slug, backendUrl });
      try {
        const parsed = await runAndParse({
          slug,
          backendUrl,
          retries: 1,
          abortSignal: ctx.abortSignal,
        });
        specResults = parsed.specResults;
      } catch (err) {
        runError = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("probe.e2e-full.suite-error", {
          slug,
          err: truncateUtf8(runError, 1200),
        });
        // specResults stays [] → rollup yields all-UNKNOWN (fail-closed).
      }

      // ---- Fail-closed rollup ------------------------------------------
      // The driver injects the declared-skip list; the rollup is PURE and
      // never reads the loader itself.
      const skipped = declaredSkipsImpl(slug);
      const cells: CellRollup[] = rollupCells({ slug, specResults, skipped });

      // ---- Emit one side row per cell (d6:<slug>/<column>) --------------
      // FAIL-CLOSED projection onto the narrower `ProbeState` vocabulary:
      //   green   → "green"
      //   red     → "red"
      //   unknown → "error"  (loud, non-green; the writer's error branch
      //                       never greens and never mutates fail_count)
      //   skipped → "green"  (neutral green-side-row, matching the legacy
      //                       skip convention) BUT carrying cellState:
      //                       "skipped" so the dashboard renders it as a
      //                       distinct skip, never as a real pass.
      // The unprojected `cellState` is carried in the signal as the source
      // of truth; the projection NEVER turns a non-green cell into green.
      for (const cell of cells) {
        const projected: ProbeState =
          cell.state === "green"
            ? "green"
            : cell.state === "red"
              ? "red"
              : cell.state === "skipped"
                ? "green"
                : "error"; // unknown
        await sideEmit(ctx, {
          key: `d6:${slug}/${cell.cellColumn}`,
          state: projected,
          signal: {
            slug,
            featureType: cell.cellColumn,
            backendUrl,
            cellState: cell.state,
            errorClass:
              cell.state === "skipped"
                ? "declared-skip"
                : cell.state === "unknown"
                  ? "no-pass-row"
                  : undefined,
            note:
              cell.state === "skipped"
                ? "declared skip (skip-list)"
                : cell.state === "unknown"
                  ? runError
                    ? "e2e run error — no parseable result"
                    : "no PASS row for this spec"
                  : undefined,
          },
          observedAt: ctx.now().toISOString(),
        });
      }

      // ---- Aggregate state (fail-closed) -------------------------------
      // GREEN iff every in-scope (non-skipped) cell is green; RED if any
      // cell is red; otherwise UNKNOWN. Skipped cells are NEUTRAL — they
      // don't block green and don't count as red.
      const greenColumns: string[] = [];
      const redColumns: string[] = [];
      const unknownColumns: string[] = [];
      const skippedColumns: string[] = [];
      for (const cell of cells) {
        switch (cell.state) {
          case "green":
            greenColumns.push(cell.cellColumn);
            break;
          case "red":
            redColumns.push(cell.cellColumn);
            break;
          case "skipped":
            skippedColumns.push(cell.cellColumn);
            break;
          default:
            unknownColumns.push(cell.cellColumn);
        }
      }

      let aggregateState: "green" | "red" | "unknown";
      if (redColumns.length > 0) {
        aggregateState = "red";
      } else if (unknownColumns.length > 0) {
        // Any missing/errored cell keeps the aggregate UNKNOWN — never green.
        aggregateState = "unknown";
      } else if (greenColumns.length > 0) {
        // Every non-skipped cell is green (skipped cells are neutral).
        aggregateState = "green";
      } else {
        // Only skipped cells (or no cells) — nothing actually passed.
        aggregateState = "unknown";
      }

      // FAIL-CLOSED projection onto `ProbeState`: unknown → "error"
      // (never green). The precise verdict rides in `signal.aggregateState`.
      const projectedState: ProbeState =
        aggregateState === "unknown" ? "error" : aggregateState;

      ctx.logger.info("probe.e2e-full.suite-complete", {
        slug,
        total: cells.length,
        green: greenColumns.length,
        red: redColumns.length,
        unknown: unknownColumns.length,
        skipped: skippedColumns.length,
        aggregateState,
        durationMs: Date.now() - runStart,
      });

      const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
        key: input.key,
        state: projectedState,
        signal: {
          shape: "package",
          slug,
          backendUrl,
          total: cells.length,
          passed: greenColumns.length,
          failed: redColumns.length > 0 ? redColumns : [],
          skipped: skippedColumns,
          unknown: unknownColumns.length > 0 ? unknownColumns : undefined,
          aggregateState,
          failureSummary:
            redColumns.length > 0
              ? redColumns.map((c) => `${c}: spec failed`).join("; ")
              : runError
                ? `e2e run error: ${truncateUtf8(runError, 600)}`
                : undefined,
          errorDesc: runError ? "suite-error" : undefined,
        },
        observedAt,
      };
      // Unconditional dashboard-contract emit of the aggregate `d6:<slug>`
      // row (the dashboard reads this exact key).
      await emitAggregate(ctx, slug, aggregateResult);
      return aggregateResult;
    },
  };
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
