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
 *   1. Invoke the integration's e2e suite via `runAndParse` (with
 *      `--retries=0` for verdict-equivalence — D6 observes the same
 *      first-attempt verdict a human/CI run does, no flake-masking retry).
 *      Returns `SpecFileResult[]`.
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
 * The conversation-runner is referenced here ONLY for its `Page` type (a
 * type-only import — erased at runtime); the runtime DOM-node-counting
 * heuristic path is NOT used by the D6 spec-driven flow. Full retirement of
 * the conversation-runner from the codebase is a later task.
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
   * is a fail-closed projection of this onto the `ProbeState` vocabulary
   * (`unknown` maps 1:1 onto the neutral no-evidence `unknown` ProbeState;
   * `skipped` — which has no ProbeState of its own — collapses onto the same
   * neutral `unknown`), but `cellState` carries the unprojected truth for the
   * dashboard rollup and audit. A green `cellState` is the ONLY value that
   * greens the cell.
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
 * Green iff every non-skipped cell is green; skipped cells are neutral (they
 * neither block green nor count as red). Any red cell makes the aggregate
 * red; any missing/untrustworthy cell with no red makes it `unknown`.
 *
 * `skipped` carries the column names of cells the spec-driven driver
 * declared "not applicable" via the skip-list (see `declaredSkips(slug)`).
 * Skips come ONLY from the skip-list — they are neutral (not counted as
 * red, do not block green).
 */
export interface E2eFullAggregateSignal {
  shape: "package";
  slug: string;
  backendUrl: string;
  total: number;
  passed: number;
  failed: string[];
  skipped: string[];
  note?: string;
  errorDesc?: string;
  failureSummary?: string;
  /**
   * Column names of cells in the PRECISE `unknown` rollup state. `unknown`
   * now has a 1:1 `ProbeState` equivalent (the neutral no-evidence state),
   * but `skipped` does not — this list lets the dashboard render the true
   * breakdown (distinguishing a declared skip from a no-evidence unknown)
   * even though both project onto the same `unknown` ProbeState.
   */
  unknown?: string[];
  /**
   * The PRECISE aggregate rollup verdict: `green` | `red` | `unknown`. The
   * emitted `ProbeResult.state` carries `unknown` through directly (it is a
   * real, neutral `ProbeState` whose writer success path overwrites the cell
   * — fail-closed: never green without a real PASS).
   */
  aggregateState?: "green" | "red" | "unknown";
}

/**
 * Minimal page surface the driver depends on. Same shape as E2eDeepPage
 * from d5-single-pill.ts.
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
   * Playwright retry count. The D6 driver passes `0` for verdict-equivalence
   * with the human/CI paths (shared integration base config is `retries:0`) —
   * a single retry value across all three paths so D6 observes the same
   * first-attempt verdict, with no flake-masking retry.
   */
  retries: number;
}

/**
 * Spec-driven measurement seam: run the integration's Playwright e2e suite
 * with the JSON reporter and return per-spec-FILE verdicts. The production
 * default wraps `runE2eAndParse` (cli/e2e.ts). Injected in tests so the
 * driver is exercised against scripted results without spawning Playwright.
 *
 * FAIL-CLOSED contract: an errored/empty run returns `{ exitCode, specResults:
 * [] }` (or throws) — the driver maps that to all-UNKNOWN cells, never green.
 *
 * `exitCode` is the run's process exit status. A non-zero exit is NORMAL when
 * some specs failed and is NOT, by itself, a reason to distrust the report: a
 * Playwright run with failing specs exits non-zero AND still writes a fully-
 * trustworthy JSON report with real per-spec PASS/FAIL rows. The driver trusts
 * the PARSED REPORT: when `specResults` carries real per-spec rows, PASS rows
 * green their cells and FAIL rows red theirs regardless of the exit code. The
 * genuine fail-closed case is a non-zero exit WITH AN EMPTY `specResults`
 * (crash / global-setup / webServer / fixture failure / worker crash before
 * any spec reported, or an empty/unparseable report) — those collapse to
 * `specResults: []` here, and the driver downgrades every would-be-green cell
 * to `unknown` only in that no-rows-parsed case.
 */
export type D6RunAndParse = (
  args: D6RunAndParseArgs,
) => Promise<{ exitCode: number; specResults: SpecFileResult[] }>;

export interface E2eFullDriverDeps {
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
 * D6's nominal per-integration feature concurrency (4, vs D5's 2). The
 * spec-driven run path delegates real parallelism to Playwright's own
 * `--workers`; this constant is retained as the documented concurrency budget
 * and is asserted by the unit suite.
 */
export const FEATURE_CONCURRENCY_D6 = 4;

/**
 * Inline counting semaphore — gates concurrent access to a bounded
 * resource (here: browser contexts). Same implementation as d5-single-pill.
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

/**
 * D5 script file matcher — reused from d5-single-pill for the shared script
 * loader. Accepts `d5-<name>.{js,ts}` but rejects test files, .d.ts,
 * and non-d5 prefixed files.
 */
export const D5_SCRIPT_FILE_MATCHER =
  /^d5-(?!.*\.test\.)(?!.*\.d\.).*\.(js|ts)$/;

/**
 * Default script loader — scans `<driverDir>/../scripts/` for D5 script
 * files. Same as d5-single-pill's loader.
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
  const { exitCode, specResults } = await runE2eAndParse(
    slug,
    { tier: "d6", retries, baseUrlOverride: backendUrl },
    config,
  );
  return { exitCode, specResults };
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
            // FAIL-CLOSED during deploy churn: emit the neutral `unknown`
            // ("no-evidence") state. The writer's SUCCESS path OVERWRITES the
            // row's state to `unknown` and resets fail_count — so a deploy in
            // progress neither greens a cell nor trips a false red, AND a
            // previously-green cell loses its green (the prior bug projected
            // this onto ProbeState `"error"`, whose error branch CARRIED the
            // green forward → false-green). The precise verdict still rides in
            // `aggregateState: "unknown"`.
            const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
              key: input.key,
              state: "unknown",
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
      // VERDICT-EQUIVALENCE: retries=0, matching the shared integration base
      // config (human + CI both run retries=0). A retry would let a flaky
      // PASS mask a real failure, so D6 must observe the SAME first-attempt
      // verdict a human/CI run would — one retry value across all three paths.
      // FAIL-CLOSED: any error here yields empty specResults → all-UNKNOWN
      // cells, never green.
      const runStart = Date.now();
      let specResults: SpecFileResult[] = [];
      // Defaults to 0 (trustworthy); a non-zero exit OR a thrown error makes
      // the run untrustworthy. We seed it to a non-zero sentinel on throw so
      // the same downgrade path applies. A clean run overwrites it with the
      // real (zero) exit code.
      let exitCode = 0;
      let runError: string | undefined;
      ctx.logger.info("probe.e2e-full.suite-start", { slug, backendUrl });
      try {
        const parsed = await runAndParse({
          slug,
          backendUrl,
          retries: 0,
        });
        specResults = parsed.specResults;
        exitCode = parsed.exitCode;
      } catch (err) {
        runError = err instanceof Error ? err.message : String(err);
        exitCode = 1; // a thrown runner is an untrustworthy (non-zero) run
        ctx.logger.warn("probe.e2e-full.suite-error", {
          slug,
          err: truncateUtf8(runError, 1200),
        });
        // specResults stays [] → rollup yields all-UNKNOWN (fail-closed).
      }

      // TRUSTWORTHINESS is the parsed report, NOT the exit code alone. A
      // NORMAL Playwright run with some failing specs exits NON-ZERO and STILL
      // writes a fully-trustworthy JSON report carrying real per-spec PASS/FAIL
      // rows — downgrading those PASS rows to `unknown` just because the
      // process exited non-zero nukes genuinely-passing cells (the in-container
      // LGP run that exposed this showed green:0/unknown:36 despite 36 real
      // PASS rows). So a cell is trustworthy whenever the parser produced real
      // per-spec rows (`specResults.length > 0`).
      //
      // The genuine fail-closed case is a non-zero exit WITH NO parsed rows:
      // a crash / global-setup / webServer / fixture failure / worker SIGSEGV
      // before any spec reported, or an empty/unparseable report. `runE2eAndParse`
      // collapses ALL of those to `specResults: []`, so an empty parse under a
      // non-zero exit is the real untrustworthy signal → all cells `unknown`,
      // never green. (Red rows can only exist when rows were parsed, so this
      // path never has any red to preserve.)
      const reportHasRows = specResults.length > 0;
      const runUntrustworthy = exitCode !== 0 && !reportHasRows;
      if (exitCode !== 0) {
        ctx.logger.warn("probe.e2e-full.nonzero-exit", {
          slug,
          exitCode,
          reportHasRows,
          // When the report parsed real rows the non-zero exit is the NORMAL
          // "some specs failed" signal — trustworthy. Only an empty parse under
          // a non-zero exit is treated as untrustworthy (fail-closed).
          untrustworthy: runUntrustworthy,
        });
      }

      // ---- Fail-closed rollup ------------------------------------------
      // The driver injects the declared-skip list; the rollup is PURE and
      // never reads the loader itself.
      const skipped = declaredSkipsImpl(slug);
      const rawCells: CellRollup[] = rollupCells({
        slug,
        specResults,
        skipped,
      });
      // Apply the non-zero-exit downgrade uniformly here so the side-emit loop
      // and the aggregate computation below both see the corrected verdicts: a
      // `green` cell from an untrustworthy run is demoted to `unknown` (never
      // green); `red`/`unknown`/`skipped` cells are unchanged.
      const cells: CellRollup[] = runUntrustworthy
        ? rawCells.map((cell) =>
            cell.state === "green" ? { ...cell, state: "unknown" } : cell,
          )
        : rawCells;

      // ---- Emit one side row per cell (d6:<slug>/<column>) --------------
      // FAIL-CLOSED projection onto the `ProbeState` vocabulary:
      //   green   → "green"
      //   red     → "red"
      //   unknown → "unknown"  (the neutral "no-evidence" state — the writer's
      //                         SUCCESS path OVERWRITES the cell's persisted
      //                         state to `unknown` and resets fail_count, so a
      //                         previously-green cell loses its green instead
      //                         of carrying it forward. Pre-fix this projected
      //                         to `"error"`, whose error branch CARRIED the
      //                         prior green forward → false-green.)
      //   skipped → "unknown"  (NON-green neutral — a skip must NEVER project
      //                         to green. The dashboard's `StatusRow.state`
      //                         (live-status.ts) is read directly, so a
      //                         "green" projection here would render a skipped
      //                         spec as a REAL pass. We route it onto the same
      //                         neutral `unknown` path so it can't read as a
      //                         pass; `cellState: "skipped"` is still carried
      //                         for audit so the dashboard can render a
      //                         dedicated skip tone.
      // The unprojected `cellState` is carried in the signal as the source
      // of truth; the projection NEVER turns a non-green cell into green.
      for (const cell of cells) {
        const projected: ProbeState =
          cell.state === "green"
            ? "green"
            : cell.state === "red"
              ? "red"
              : "unknown"; // unknown OR skipped → neutral, NON-green
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
                    : runUntrustworthy
                      ? `pass cell downgraded — e2e run exited non-zero (code ${exitCode})`
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

      // FAIL-CLOSED projection onto `ProbeState`: the aggregate `unknown`
      // verdict projects to the neutral `unknown` ProbeState (never green).
      // The writer's success path OVERWRITES the persisted state to `unknown`
      // (resetting fail_count) so a previously-green aggregate loses its green
      // — the prior bug projected to `"error"`, carrying the green forward.
      // The precise verdict also rides in `signal.aggregateState`.
      const projectedState: ProbeState = aggregateState;

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
                : runUntrustworthy
                  ? `e2e run exited non-zero (code ${exitCode}) with no failed-spec row — run untrustworthy, pass cells downgraded to unknown`
                  : undefined,
          errorDesc: runError
            ? "suite-error"
            : runUntrustworthy
              ? "nonzero-exit"
              : undefined,
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
