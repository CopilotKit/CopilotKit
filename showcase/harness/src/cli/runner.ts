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
} from "./targets.js";

import { up, down, rebuild, isRunning } from "./lifecycle.js";

import {
  printResult,
  printSummary,
  probeResultToTerminal,
  createPbWriter,
} from "./results.js";
import type { TerminalResult, PbWriteConfig } from "./results.js";

import { livenessDriver } from "../probes/drivers/liveness.js";
import { e2eChatToolsDriver } from "../probes/drivers/e2e-chat-tools.js";
import { createE2eDeepDriver } from "../probes/drivers/e2e-deep.js";
import type { E2eDeepBrowser } from "../probes/drivers/e2e-deep.js";
import type { StatusWriter } from "../writers/status-writer.js";

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
}

export interface RunResult {
  target: string;
  results: TerminalResult[];
  passed: number;
  failed: number;
  durationMs: number;
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

  // -- 4. Start missing services (with optional rebuild) --------------------
  if (autoStarted.length > 0) {
    console.log(
      `\n  \x1b[36mStarting services:\x1b[0m ${autoStarted.join(", ")}`,
    );

    if (options.rebuild) {
      logger.info("cli.runner.rebuilding", { slugs: autoStarted });
      await rebuild(autoStarted);
    }

    await up(autoStarted);

    // up() already runs healthCheck internally, so services are healthy here
    console.log("  \x1b[32mAll services healthy\x1b[0m\n");
  }

  // -- 5. Build ProbeContext ------------------------------------------------
  const pbConfig = options.live ? resolvePbConfig(config) : null;
  const pbWriter = pbConfig ? createPbWriter(pbConfig, logger) : null;

  const ctx: ProbeContext = {
    now: () => new Date(),
    logger,
    env: { ...process.env, SHOWCASE_LOCAL: "1" },
    abortSignal: abortController.signal,
    // Wire the PB writer into the probe context so drivers that emit
    // per-feature side rows (e2e-deep emits `d5:<slug>/<featureType>`)
    // actually land in PocketBase. Without this the runner only wrote
    // the aggregate `e2e-deep:<slug>` row and every D5 cell stayed gray
    // on the dashboard. `pbWriter` is null when --live wasn't passed,
    // matching the legacy behaviour of skipping side emission.
    ...(pbWriter !== null && { writer: pbWriter }),
  };

  // -- 6. Create headed-mode deep driver if needed --------------------------
  // The D5 driver launches Playwright internally. For --headed mode, we
  // create a custom driver instance with a launcher that passes
  // headless: false. The e2e-chat-tools driver also launches Playwright
  // but doesn't expose a headed toggle — we pass HEADED=1 via env.
  if (options.headed) {
    ctx.env = { ...ctx.env, HEADED: "1", PLAYWRIGHT_HEADLESS: "0" };
  }

  const deepDriver = options.headed
    ? createE2eDeepDriver({
        launcher: async (): Promise<E2eDeepBrowser> => {
          const mod =
            (await import("playwright")) as typeof import("playwright");
          const browser = await mod.chromium.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-dev-shm-usage"],
          });
          return {
            async newContext() {
              const bCtx = await browser.newContext();
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
                  }) as unknown as import("../probes/drivers/e2e-deep.js").E2eDeepPage;
                },
                close: () => bCtx.close(),
              };
            },
            close: () => browser.close(),
          };
        },
      })
    : createE2eDeepDriver();

  // -- 7. Run probes --------------------------------------------------------
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

          const iterResults = await runLevel(
            depth,
            testTarget,
            ctx,
            config,
            deepDriver,
            pbWriter,
            logger,
          );

          allResults.push(...iterResults);
        }
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);

    // -- 8. Stop auto-started services if not --keep -------------------------
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

  // -- 9. Print summary -----------------------------------------------------
  printSummary(allResults);

  const passed = allResults.filter((r) => r.state === "green").length;
  const failed = allResults.filter((r) => r.state !== "green").length;

  return {
    target,
    results: allResults,
    passed,
    failed,
    durationMs: Date.now() - runStart,
  };
}

// ---------------------------------------------------------------------------
// Level expansion
// ---------------------------------------------------------------------------

type DepthLevel = "smoke" | "d4" | "d5";

/**
 * Expand a TestLevel into the ordered sequence of depth levels to run.
 * "all" runs smoke -> d4 -> d5 in sequence.
 */
function expandLevel(level: TestLevel): DepthLevel[] {
  switch (level) {
    case "smoke":
      return ["smoke"];
    case "d4":
      return ["d4"];
    case "d5":
      return ["d5"];
    case "all":
      return ["smoke", "d4", "d5"];
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
  deepDriver: ProbeDriver<unknown, unknown>,
  pbWriter: StatusWriter | null,
  logger: Logger,
): Promise<TerminalResult[]> {
  const results: TerminalResult[] = [];
  const { slug } = testTarget;

  console.log(`\n  \x1b[1m${slug}\x1b[0m \x1b[2m[${depth}]\x1b[0m`);

  switch (depth) {
    case "smoke": {
      const inputs = buildSmokeInputs(testTarget, config);
      for (const input of inputs) {
        if (ctx.abortSignal?.aborted) break;
        const startedAt = Date.now();
        try {
          const result = await livenessDriver.run(ctx, input);
          const terminal = probeResultToTerminal(result, startedAt);
          printResult(terminal);
          results.push(terminal);
          await bestEffortPbWrite(result, pbWriter, logger);
        } catch (err) {
          const terminal = errorToTerminal(
            `smoke:${slug}`,
            err,
            Date.now() - startedAt,
          );
          printResult(terminal);
          results.push(terminal);
        }
      }
      break;
    }

    case "d4": {
      const inputs = buildChatToolsInputs(testTarget, config);
      for (const input of inputs) {
        if (ctx.abortSignal?.aborted) break;
        const startedAt = Date.now();
        try {
          const result = await e2eChatToolsDriver.run(ctx, input);
          const terminal = probeResultToTerminal(result, startedAt);
          printResult(terminal);
          results.push(terminal);
          await bestEffortPbWrite(result, pbWriter, logger);
        } catch (err) {
          const terminal = errorToTerminal(
            `d4:${slug}`,
            err,
            Date.now() - startedAt,
          );
          printResult(terminal);
          results.push(terminal);
        }
      }
      break;
    }

    case "d5": {
      const inputs = buildDeepInputs(testTarget, config);
      for (const input of inputs) {
        if (ctx.abortSignal?.aborted) break;
        const startedAt = Date.now();
        try {
          const result = await deepDriver.run(ctx, input);
          const terminal = probeResultToTerminal(result, startedAt);
          printResult(terminal);
          results.push(terminal);
          await bestEffortPbWrite(result, pbWriter, logger);
        } catch (err) {
          const terminal = errorToTerminal(
            `e2e-deep:${slug}`,
            err,
            Date.now() - startedAt,
          );
          printResult(terminal);
          results.push(terminal);
        }
      }
      break;
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
 * Convert a caught error into a TerminalResult for display.
 */
function errorToTerminal(
  key: string,
  err: unknown,
  durationMs: number,
): TerminalResult {
  return {
    key,
    state: "error",
    durationMs,
    error: err instanceof Error ? err.message : String(err),
  };
}
