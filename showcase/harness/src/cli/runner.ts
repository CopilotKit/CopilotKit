/**
 * CLI test runner — orchestrates probe execution against locally running
 * showcase services. Wires targets (from B4), lifecycle management (from
 * B3), and existing probe drivers into a single `run()` entry point that
 * the CLI command handler calls.
 *
 * Flow:
 *   1. Parse and resolve targets into concrete services + test levels.
 *   2. Start missing services via docker-compose (lifecycle.up).
 *   3. Wait for health checks.
 *   4. Build ProbeContext with AbortSignal for Ctrl+C.
 *   5. Run probe drivers at the requested depth levels.
 *   6. Print results and optionally write to PocketBase.
 *   7. Optionally stop auto-started services.
 */

import type { ProbeContext, Logger } from "../types/index.js";
import type { ProbeResult } from "../types/index.js";
import type { ProbeDriver } from "../probes/types.js";

import type { TestLevel, TestTarget } from "./targets.js";
import type { LocalConfig } from "./config.js";
import {
  resolveTargets,
  buildSmokeInputs,
  buildChatToolsInputs,
  buildDeepInputs,
  buildFullInputs,
} from "./targets.js";

import { up, down, rebuild, isRunning, healthCheck } from "./lifecycle.js";

import {
  printResult,
  printSummary,
  probeResultToTerminal,
  createPbWriter,
} from "./results.js";
import type { TerminalResult, PbWriteConfig } from "./results.js";

import { livenessDriver } from "../probes/drivers/d2-liveness.js";
import { e2eChatToolsDriver } from "../probes/drivers/d4-chat-roundtrip.js";
import {
  createE2eFullDriver,
  openGuardedContext,
} from "../probes/drivers/d6-all-pills.js";
import type { E2eFullBrowser } from "../probes/drivers/d6-all-pills.js";
import type { StatusWriter } from "../writers/status-writer.js";
import { runViaControlPlane } from "./control-plane-run.js";
import type { ControlPlaneLevel } from "./control-plane-run.js";
import { createPbClient } from "../storage/pb-client.js";
import { buildCvdiagPersistenceWriter } from "../orchestrator.js";
import type { CvdiagPbWriter } from "../cvdiag/pb-writer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunOptions {
  level: TestLevel;
  /** Launch Playwright in headed mode (visible browser window). */
  headed?: boolean;
  /** Number of times to repeat the probe execution. */
  repeat?: number;
  /** Keep auto-started services running after the run completes. */
  keep?: boolean;
  /** Write results to PocketBase in real-time. */
  live?: boolean;
  /** Rebuild docker images before starting services. */
  rebuild?: boolean;
  /** Enable verbose logging output. */
  verbose?: boolean;
  /**
   * Legacy/debug escape hatch: run d5/d6 via the in-process `runLevel()`
   * driver instead of the fleet control-plane. Default (false) drives d5/d6
   * through the producer → queue → worker → aggregator wiring so the dev tool
   * exercises the IDENTICAL path staging runs. Has no effect on smoke/d4
   * (those have no fleet path and always run in-process).
   */
  direct?: boolean;
}

export interface RunResult {
  target: string;
  results: TerminalResult[];
  passed: number;
  /**
   * A5 (round 7): degraded results, counted separately — degraded is a
   * distinct durable state (the C3 split the summary already renders), NOT
   * a failure, so it no longer inflates `failed` (and no longer fails the
   * CLI exit code).
   */
  degraded: number;
  /** red + error results only — excludes degraded (A5 round 7). */
  failed: number;
  durationMs: number;
}

/**
 * Split terminal results into the C3 passed/degraded/failed buckets
 * (A5(i) round 7). Mirrors printSummary's rendering split so the counts the
 * CLI exits on agree with the counts the operator reads.
 */
export function countTerminalStates(results: TerminalResult[]): {
  passed: number;
  degraded: number;
  failed: number;
} {
  let passed = 0;
  let degraded = 0;
  let failed = 0;
  for (const r of results) {
    if (r.state === "green") passed += 1;
    else if (r.state === "degraded") degraded += 1;
    else failed += 1;
  }
  return { passed, degraded, failed };
}

// ---------------------------------------------------------------------------
// CLI logger
// ---------------------------------------------------------------------------

function createCliLogger(verbose?: boolean): Logger {
  return {
    info: (msg, meta) => {
      if (verbose) {
        if (meta) {
          console.log(`\x1b[36m[info]\x1b[0m ${msg}`, JSON.stringify(meta));
        } else {
          console.log(`\x1b[36m[info]\x1b[0m ${msg}`);
        }
      }
    },
    warn: (msg, meta) => {
      if (meta) {
        console.warn(`\x1b[33m[warn]\x1b[0m ${msg}`, JSON.stringify(meta));
      } else {
        console.warn(`\x1b[33m[warn]\x1b[0m ${msg}`);
      }
    },
    error: (msg, meta) => {
      if (meta) {
        console.error(`\x1b[31m[error]\x1b[0m ${msg}`, JSON.stringify(meta));
      } else {
        console.error(`\x1b[31m[error]\x1b[0m ${msg}`);
      }
    },
    debug: (msg, meta) => {
      if (verbose) {
        if (meta) {
          console.log(`\x1b[2m[debug]\x1b[0m ${msg}`, JSON.stringify(meta));
        } else {
          console.log(`\x1b[2m[debug]\x1b[0m ${msg}`);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// PocketBase config resolution
// ---------------------------------------------------------------------------

function resolvePbConfig(config: LocalConfig): PbWriteConfig {
  return {
    url: config.pocketbase.url,
    email: config.pocketbase.email,
    password: config.pocketbase.password,
  };
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Run probes against a target at the specified depth level. This is the
 * primary entry point for the CLI's `test` command.
 *
 * @param target - Raw target string (e.g. "langgraph-python", "all")
 * @param options - Run configuration (level, headed, repeat, etc.)
 * @param config - Local configuration (ports, PB creds, etc.)
 * @returns RunResult with aggregated pass/fail counts and timing
 */
export async function run(
  target: string,
  options: RunOptions,
  config: LocalConfig,
): Promise<RunResult> {
  const logger = createCliLogger(options.verbose);
  const runStart = Date.now();
  const allResults: TerminalResult[] = [];

  // -- 1. Resolve targets ----------------------------------------------------
  const targets = resolveTargets(target, options.level, config);

  logger.info("cli.runner.resolved-targets", {
    target,
    level: options.level,
    count: targets.length,
  });

  // -- 2. Determine which services need to be running -----------------------
  const slugs = [...new Set(targets.map((t) => t.slug))];
  const autoStarted: string[] = [];

  for (const slug of slugs) {
    const running = await isRunning(slug);
    if (!running) {
      autoStarted.push(slug);
    }
  }

  // -- 3. Set up abort signal for Ctrl+C ------------------------------------
  const abortController = new AbortController();
  const onSigint = (): void => {
    console.log("\n\x1b[33mAborting...\x1b[0m");
    abortController.abort();
  };
  process.on("SIGINT", onSigint);

  // -- 4. Rebuild targeted services if requested ----------------------------
  // --rebuild must force a rebuild + recreate of EVERY targeted service,
  // including ones that are already running — otherwise a stale container
  // is silently reused (the 36h-stale-image false-positive). rebuild()
  // builds the fresh image and force-recreates the container, and includes
  // the infra profile so `aimock` (and friends) resolve.
  if (options.rebuild && slugs.length > 0) {
    console.log(`\n  \x1b[36mRebuilding services:\x1b[0m ${slugs.join(", ")}`);
    logger.info("cli.runner.rebuilding", { slugs });
    await rebuild(slugs);
  }

  // -- 5. Start missing services -------------------------------------------
  if (autoStarted.length > 0) {
    console.log(
      `\n  \x1b[36mStarting services:\x1b[0m ${autoStarted.join(", ")}`,
    );

    await up(autoStarted);

    // up() already runs healthCheck internally, so services are healthy here
    console.log("  \x1b[32mAll services healthy\x1b[0m\n");
  }

  // -- 6. Health-check rebuilt-but-already-running services -----------------
  // up() above only health-checks services it started. A service that was
  // already running and got force-recreated by rebuild() is healthy-pending
  // — verify it before probing so a broken rebuild fails loud here rather
  // than mid-probe.
  if (options.rebuild) {
    const recreatedRunning = slugs.filter((s) => !autoStarted.includes(s));
    if (recreatedRunning.length > 0) {
      const results = await healthCheck(recreatedRunning);
      const unhealthy = [...results.entries()]
        .filter(([, ok]) => !ok)
        .map(([name]) => name);
      if (unhealthy.length > 0) {
        throw new Error(
          `Health check failed after rebuild for: ${unhealthy.join(", ")}. Check logs with: showcase logs <slug>`,
        );
      }
      console.log("  \x1b[32mRebuilt services healthy\x1b[0m\n");
    }
  }

  // -- 7. Build ProbeContext ------------------------------------------------
  const pbConfig = options.live ? resolvePbConfig(config) : null;
  const pbWriter = pbConfig ? createPbWriter(pbConfig, logger) : null;

  // CVDIAG event-persistence writer for the local d5/d6 path. When `--live`
  // (a PB connection is configured), build a writer-role PB client and gate it
  // through `buildCvdiagPersistenceWriter` (the same assert-collection-exists
  // degrade-or-inject path the orchestrator uses). When wired, the d6 driver's
  // per-feature `CvdiagProbeSession` PERSISTS its probe-layer events (probe.exit
  // etc.) to `cvdiag_events` on flush — so a local `--d5`/`--d6` run is readable
  // back from PB exactly like staging. Absent (`--live` off, migration missing,
  // or PB unreachable) → undefined → the emitter's flush is a clean no-op.
  let cvdiagWriter: CvdiagPbWriter | undefined;
  if (pbConfig) {
    const cvdiagPb = createPbClient({
      url: pbConfig.url,
      email: pbConfig.email,
      password: pbConfig.password,
      logger,
    });
    cvdiagWriter = await buildCvdiagPersistenceWriter(cvdiagPb, logger);
  }

  const ctx: ProbeContext = {
    now: () => new Date(),
    logger,
    env: { ...process.env, SHOWCASE_LOCAL: "1" },
    abortSignal: abortController.signal,
    // Wire the PB writer into the probe context so drivers that emit
    // per-feature side rows (d5-single-pill-e2e emits `d5:<slug>/<featureType>`)
    // actually land in PocketBase. Without this the runner only wrote
    // the aggregate `d5-single-pill-e2e:<slug>` row and every D5 cell stayed gray
    // on the dashboard. `pbWriter` is null when --live wasn't passed,
    // matching the legacy behaviour of skipping side emission.
    ...(pbWriter !== null && { writer: pbWriter }),
  };

  // -- 8. Create headed-mode driver if needed -------------------------------
  // The D6 driver launches Playwright internally. For --headed mode, we
  // create a custom driver instance with a launcher that passes
  // headless: false. The e2e-chat-tools driver also launches Playwright
  // but doesn't expose a headed toggle — we pass HEADED=1 via env. D5 now
  // runs this SAME D6 driver ("D5 take-one"), differentiated only by its
  // inputs (`representativeOnly` + `rowPrefix: "d5"`), so one driver instance
  // serves both the d5 and d6 levels.
  if (options.headed) {
    ctx.env = { ...ctx.env, HEADED: "1", PLAYWRIGHT_HEADLESS: "0" };
  }

  const fullDriver = options.headed
    ? createE2eFullDriver({
        launcher: async (): Promise<E2eFullBrowser> => {
          const mod =
            (await import("playwright")) as typeof import("playwright");
          const browser = await mod.chromium.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-dev-shm-usage"],
          });
          return {
            async newContext(contextOpts?: {
              extraHTTPHeaders?: Record<string, string>;
            }) {
              // GUARD: same shared-browser disconnect guard as defaultLauncher
              // — refuse to open on a dead browser and convert a mid-open
              // disconnect into a clean BrowserDisconnectedError rather than
              // leaking Playwright's raw "has been closed" string.
              const bCtx = await openGuardedContext<
                Awaited<ReturnType<typeof browser.newContext>>
              >(browser, {
                extraHTTPHeaders: {
                  "X-AIMock-Strict": "true",
                  ...contextOpts?.extraHTTPHeaders,
                },
              });
              return {
                async newPage() {
                  const page = await bCtx.newPage();
                  const consoleLogs: string[] = [];
                  const requestFailures: string[] = [];
                  page.on(
                    "console",
                    (msg: { type(): string; text(): string }) => {
                      const t = msg.type();
                      if (t === "error" || t === "warning") {
                        consoleLogs.push(`[${t}] ${msg.text().slice(0, 200)}`);
                      }
                    },
                  );
                  page.on(
                    "requestfailed",
                    (request: {
                      method(): string;
                      url(): string;
                      failure(): { errorText: string } | null;
                    }) => {
                      requestFailures.push(
                        `${request.method()} ${request.url().slice(0, 200)} => ${
                          request.failure()?.errorText || "unknown"
                        }`,
                      );
                    },
                  );
                  return Object.assign(page, {
                    getDiagnostics: () => ({
                      consoleLogs: consoleLogs.slice(-20),
                      requestFailures: requestFailures.slice(-10),
                    }),
                    isClosed: () => page.isClosed(),
                    locator: (s: string) => page.locator(s),
                    route: (
                      u: string | RegExp,
                      handler: Parameters<typeof page.route>[1],
                    ) => page.route(u, handler),
                    unroute: (u: string | RegExp) => page.unroute(u),
                  }) as unknown as import("../probes/drivers/d6-all-pills.js").E2eFullPage;
                },
                close: () => bCtx.close(),
              };
            },
            close: () => browser.close(),
          };
        },
        // CVDIAG persistence for the local d5/d6 path (headed).
        cvdiagPbWriter: cvdiagWriter,
      })
    : createE2eFullDriver({ cvdiagPbWriter: cvdiagWriter });

  // -- 9. Run probes --------------------------------------------------------
  const repeatCount = Math.max(1, options.repeat ?? 1);

  try {
    for (let iteration = 0; iteration < repeatCount; iteration++) {
      if (abortController.signal.aborted) break;

      if (repeatCount > 1) {
        console.log(
          `\n  \x1b[36mIteration ${iteration + 1}/${repeatCount}\x1b[0m`,
        );
      }

      for (const testTarget of targets) {
        if (abortController.signal.aborted) break;

        const { level } = testTarget;
        const levelList = expandLevel(level);

        for (const depth of levelList) {
          if (abortController.signal.aborted) break;

          // d5/d6 default to the fleet CONTROL-PLANE path (producer → queue →
          // worker → aggregator), making this dev tool faithful to staging by
          // construction. `--direct` forces the legacy in-process runLevel()
          // driver. smoke/d4 have no fleet path and always run in-process.
          if ((depth === "d5" || depth === "d6") && !options.direct) {
            const iterResults = await runViaControlPlane(
              [testTarget],
              {
                level: depth as ControlPlaneLevel,
                verbose: options.verbose,
              },
              config,
              logger,
            );
            for (const r of iterResults) printResult(r);
            allResults.push(...iterResults);
            continue;
          }

          const iterResults = await runLevel(
            depth,
            testTarget,
            ctx,
            config,
            fullDriver,
            pbWriter,
            logger,
          );

          allResults.push(...iterResults);
        }
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);

    // -- 10. Stop auto-started services if not --keep ------------------------
    if (!options.keep && autoStarted.length > 0) {
      console.log(
        `\n  \x1b[2mStopping auto-started services: ${autoStarted.join(", ")}\x1b[0m`,
      );
      try {
        await down(autoStarted, {});
      } catch (err) {
        logger.warn("cli.runner.down-failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // -- 11. Print summary ----------------------------------------------------
  // B1 / A4 (round 7): surface every dropped PB write — whether the writer
  // never constructed (init failure) or a live writer swallowed individual
  // write failures mid-run. The flag lets the summary name the cause.
  printSummary(
    allResults,
    pbWriter
      ? {
          pbDroppedWrites: pbWriter.droppedWriteCount(),
          pbWriterInitFailed: pbWriter.initFailed,
        }
      : undefined,
  );

  const { passed, degraded, failed } = countTerminalStates(allResults);

  return {
    target,
    results: allResults,
    passed,
    degraded,
    failed,
    durationMs: Date.now() - runStart,
  };
}

// ---------------------------------------------------------------------------
// Level expansion
// ---------------------------------------------------------------------------

type DepthLevel = "smoke" | "d4" | "d5" | "d6";

/**
 * Expand a TestLevel into the ordered sequence of depth levels to run.
 * "all" runs smoke -> d4 -> d5 -> d6 in sequence.
 */
function expandLevel(level: TestLevel): DepthLevel[] {
  switch (level) {
    case "smoke":
      return ["smoke"];
    case "d4":
      return ["d4"];
    case "d5":
      return ["d5"];
    case "d6":
      return ["d6"];
    case "all":
      return ["smoke", "d4", "d5", "d6"];
    default:
      throw new Error(`Unknown test level: ${level}`);
  }
}

// ---------------------------------------------------------------------------
// Per-level driver execution
// ---------------------------------------------------------------------------

/**
 * Run probes at a single depth level for a single target. Returns the
 * TerminalResult array for all inputs at that level.
 */
async function runLevel(
  depth: DepthLevel,
  testTarget: TestTarget,
  ctx: ProbeContext,
  config: LocalConfig,
  fullDriver: ProbeDriver<unknown, unknown>,
  pbWriter: StatusWriter | null,
  logger: Logger,
): Promise<TerminalResult[]> {
  const results: TerminalResult[] = [];
  const { slug } = testTarget;

  console.log(`\n  \x1b[1m${slug}\x1b[0m \x1b[2m[${depth}]\x1b[0m`);

  switch (depth) {
    case "smoke": {
      results.push(
        ...(await runDriverInputs(
          buildSmokeInputs(testTarget, config),
          livenessDriver,
          ctx,
          pbWriter,
          logger,
        )),
      );
      break;
    }

    case "d4": {
      results.push(
        ...(await runDriverInputs(
          buildChatToolsInputs(testTarget, config),
          e2eChatToolsDriver,
          ctx,
          pbWriter,
          logger,
        )),
      );
      break;
    }

    case "d5": {
      // D5 = "D6 take-one": run the SAME D6 driver, scoped by the inputs
      // (`representativeOnly` + `rowPrefix: "d5"`) that buildDeepInputs stamps.
      results.push(
        ...(await runDriverInputs(
          buildDeepInputs(testTarget, config),
          fullDriver,
          ctx,
          pbWriter,
          logger,
        )),
      );
      break;
    }

    case "d6": {
      results.push(
        ...(await runDriverInputs(
          buildFullInputs(testTarget, config),
          fullDriver,
          ctx,
          pbWriter,
          logger,
        )),
      );
      break;
    }
  }

  return results;
}

/**
 * Run one probe driver over its inputs: print + collect each terminal
 * result, best-effort persist to PB, convert thrown driver errors into
 * error-state terminal lines. Shared by every depth level (A5(ii) round 7
 * — previously four near-identical inline loops).
 *
 * Error-path key contract: a thrown driver error is recorded under
 * `input.key` — the SAME primary key the success path writes — so the
 * error row is always consistent with the success row. This is the
 * documented d5 fix (its success key is `d5-single-pill-e2e:<slug>`, not
 * `d5:<slug>`) propagated to all levels: reconstructing `<depth>:<slug>`
 * here drifts the moment an input keyspace differs. The driver's
 * side-emitted rows (e.g. d5's `d5:<slug>/<ft>` dashboard cells) are
 * unaffected; only the primary key needs to match.
 *
 * Exported for tests.
 */
export async function runDriverInputs<I extends { key: string }>(
  inputs: I[],
  driver: {
    run(ctx: ProbeContext, input: I): Promise<ProbeResult<unknown>>;
  },
  ctx: ProbeContext,
  pbWriter: StatusWriter | null,
  logger: Logger,
): Promise<TerminalResult[]> {
  const results: TerminalResult[] = [];
  for (const input of inputs) {
    if (ctx.abortSignal?.aborted) break;
    const startedAt = Date.now();
    try {
      const result = await driver.run(ctx, input);
      const terminal = probeResultToTerminal(result, startedAt);
      printResult(terminal);
      results.push(terminal);
      await bestEffortPbWrite(result, pbWriter, logger);
    } catch (err) {
      const terminal = errorToTerminal(input.key, err, Date.now() - startedAt);
      printResult(terminal);
      results.push(terminal);
      // Persist the thrown-error row too, mirroring the returned-error-state
      // path: with --live an errored probe must land an error-state PB row
      // under the SAME primary key — skipping the write left stale dashboard
      // state and excluded the failure from the dropped-write count.
      await bestEffortPbWrite(
        {
          key: input.key,
          state: "error",
          signal: { errorDesc: terminal.error },
          observedAt: ctx.now().toISOString(),
        },
        pbWriter,
        logger,
      );
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort PocketBase write. Silently catches and logs errors.
 */
async function bestEffortPbWrite(
  result: ProbeResult<unknown>,
  writer: StatusWriter | null,
  logger: Logger,
): Promise<void> {
  if (!writer) return;
  try {
    await writer.write(result);
  } catch (err) {
    logger.warn("cli.pb-write-failed", {
      key: result.key,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Convert a caught error into a TerminalResult for display. A5(iii)
 * (round 7): the duration clamps to >= 0 — a clock adjustment mid-run can
 * make `Date.now() - startedAt` negative, and a negative duration must
 * never render (same posture as probeResultToTerminal's A5(iv) clamp).
 *
 * Exported for tests.
 */
export function errorToTerminal(
  key: string,
  err: unknown,
  durationMs: number,
): TerminalResult {
  return {
    key,
    state: "error",
    durationMs: Math.max(0, durationMs),
    error: err instanceof Error ? err.message : String(err),
  };
}
