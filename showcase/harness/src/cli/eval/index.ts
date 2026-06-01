/**
 * Eval orchestrator — registers the `eval` subcommand and implements the
 * full evaluation pipeline: scope detection, baseline comparison, tiered
 * test execution, result collection, and verdict formatting.
 *
 * Pipeline:
 *   1. Parse CLI options (--d5/--d6, --pr, --scope, --parallel, etc.)
 *   2. Optionally create git worktree for PR evaluation
 *   3. Detect affected scope via git diff
 *   4. Load/pull baseline for comparison
 *   5. Start affected services + aimock via lifecycle
 *   6. Wait for health
 *   7. Run tiered tests
 *   8. Collect & format results
 *   9. Save results + optional baseline capture
 *  10. Cleanup
 */

import type { Command } from "commander";
import { Option } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "../config.js";
import { up, down, isRunning } from "../lifecycle.js";
import { createLogger, reloadLogLevel } from "../../logger.js";

// Sibling modules created by other blitz agents — imports written against
// the agreed interfaces. These will not resolve until the sibling branches
// are merged into the integration branch.
import { classifyScope } from "./scope.js";
import type { ScopeResult } from "./scope.js";
import { pullBaseline, loadBaseline, captureBaseline } from "./baseline.js";
import type { EvalBaseline } from "./baseline.js";
import {
  collectResults,
  formatMatrix,
  formatVerdict,
  computeRegressions,
  saveResults,
} from "./matrix.js";
import type { EvalResults } from "./matrix.js";
import { runTiered } from "./runner.js";
import type { TieredRunResult, RunOptions } from "./runner.js";

const log = createLogger({ component: "eval" });

// ---------------------------------------------------------------------------
// CLI options interface
// ---------------------------------------------------------------------------

interface EvalOptions {
  level?: string;
  d5?: boolean;
  pr?: string;
  branch?: string;
  scope?: string;
  parallel?: string;
  baseline?: string;
  keep?: boolean;
  json?: boolean;
  timeout?: string;
  slug?: string;
  tier?: string;
  failFast?: boolean; // commander negates --no-fail-fast to failFast: false
  ci?: boolean;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerEvalCommand(program: Command): void {
  program
    .command("eval")
    .description("Run the D5 evaluation matrix against showcase integrations")
    .addOption(
      new Option("--level <level>", "probe depth")
        .choices(["d5"])
        .default("d5"),
    )
    .option("--d5", "shorthand for --level d5")
    .option("--pr <number>", "fetch PR into worktree and eval")
    .option("--branch <name>", "eval a specific branch in a worktree")
    .option("--scope <mode>", "affected or all", "affected")
    .option("--parallel <n>", "max concurrent test runners", "4")
    .option("--baseline <action>", "capture or compare")
    .option("--keep", "leave containers running after eval")
    .option("--json", "JSON output for CI")
    .option("--timeout <ms>", "per-test timeout", "45000")
    .option("--slug <slugs>", "override scope (comma-separated)")
    .option("--tier <n>", "run only tiers 1 through N")
    .option("--no-fail-fast", "don't stop on Tier 1 failure")
    .option(
      "--ci",
      "CI mode — skip Docker lifecycle, assume services already running",
    )
    .action(async (opts: EvalOptions) => {
      await runEval(opts);
    });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runEval(opts: EvalOptions): Promise<void> {
  // In --json mode, redirect all logger output to stderr so it doesn't
  // corrupt the JSON payload on stdout.
  if (opts.json) {
    process.env["LOG_LEVEL"] = "warn";
    reloadLogLevel();
  }

  const config = loadConfig();

  // -- 1. Resolve level ------------------------------------------------------
  const level = opts.d5 ? "d5" : (opts.level ?? "d5");

  const parallel = parseInt(opts.parallel ?? "4", 10);
  const timeout = parseInt(opts.timeout ?? "45000", 10);
  const maxTier = opts.tier ? parseInt(opts.tier, 10) : undefined;
  const failFast = opts.failFast !== false; // default true; --no-fail-fast sets to false

  log.info("eval starting", {
    level,
    parallel,
    timeout,
    scope: opts.scope,
    baseline: opts.baseline,
    failFast,
  });

  // -- 2. PR worktree setup --------------------------------------------------
  let worktreeDir: string | null = null;
  let originalCwd: string | null = null;

  if (opts.pr) {
    log.info("setting up PR worktree", { pr: opts.pr });
    const prNumber = opts.pr;
    const worktreePath = path.join(
      config.showcaseDir,
      "..",
      `.eval-pr-${prNumber}`,
    );
    worktreeDir = worktreePath;
    originalCwd = process.cwd();

    try {
      execFileSync(
        "git",
        ["fetch", "origin", `pull/${prNumber}/head:eval-pr-${prNumber}`],
        {
          cwd: config.showcaseDir,
          stdio: "pipe",
          encoding: "utf-8",
        },
      );
      execFileSync(
        "git",
        ["worktree", "add", worktreePath, `eval-pr-${prNumber}`],
        {
          cwd: config.showcaseDir,
          stdio: "pipe",
          encoding: "utf-8",
        },
      );
      process.chdir(worktreePath);
      log.info("worktree created", { path: worktreePath });
    } catch (err) {
      console.error(
        `Failed to set up PR worktree: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  } else if (opts.branch) {
    log.info("setting up branch worktree", { branch: opts.branch });
    const worktreePath = path.join(
      config.showcaseDir,
      "..",
      `.eval-branch-${opts.branch.replace(/\//g, "-")}`,
    );
    worktreeDir = worktreePath;
    originalCwd = process.cwd();

    try {
      execFileSync("git", ["worktree", "add", worktreePath, opts.branch], {
        cwd: config.showcaseDir,
        stdio: "pipe",
        encoding: "utf-8",
      });
      process.chdir(worktreePath);
      log.info("worktree created", { path: worktreePath });
    } catch (err) {
      console.error(
        `Failed to set up branch worktree: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  }

  // Save the original showcaseDir BEFORE any worktree override so that
  // cleanup can run `git worktree remove` with cwd OUTSIDE the worktree.
  const originalShowcaseDir = config.showcaseDir;

  // After worktree setup, override config.showcaseDir to point to the
  // worktree's showcase directory so tests run against the PR's code.
  if (worktreeDir) {
    const worktreeShowcase = path.join(worktreeDir, "showcase");
    config.showcaseDir = worktreeShowcase;
    config.composeFile = path.join(
      worktreeShowcase,
      "docker-compose.local.yml",
    );
    config.localPorts = JSON.parse(
      fs.readFileSync(
        path.join(worktreeShowcase, "shared/local-ports.json"),
        "utf-8",
      ),
    );
    log.info("config overridden for worktree", {
      showcaseDir: worktreeShowcase,
    });
  }

  // -- 3. Detect scope -------------------------------------------------------
  const allSlugs = Object.keys(config.localPorts);
  let scopeResult: ScopeResult;

  if (opts.slug) {
    const rawSlugs = opts.slug
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = rawSlugs.filter((s) => !allSlugs.includes(s));
    if (unknown.length > 0) {
      log.warn("unknown slugs in --slug override (skipping)", { unknown });
    }
    const slugs = rawSlugs.filter((s) => allSlugs.includes(s));
    scopeResult = {
      slugs,
      mode: "all",
      reason: `manual override: ${slugs.join(", ")}`,
    };
    log.info("manual scope override", { slugs });
  } else if (opts.scope === "all") {
    scopeResult = {
      slugs: [...allSlugs],
      mode: "all",
      reason: "user specified --scope all",
    };
    log.info("scope: all", { count: allSlugs.length });
  } else {
    let diffOutput = "";
    try {
      diffOutput = execFileSync(
        "git",
        ["diff", "--name-only", "origin/main...HEAD"],
        {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      ).trim();
    } catch {
      diffOutput = execFileSync(
        "git",
        ["diff", "--name-only", "origin/main", "HEAD"],
        {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      ).trim();
    }
    const changedFiles = diffOutput
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
    scopeResult = classifyScope(changedFiles, allSlugs);
    log.info("scope detected", {
      mode: scopeResult.mode,
      slugs: scopeResult.slugs,
    });
  }

  if (scopeResult.slugs.length === 0) {
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            version: 1,
            timestamp: new Date().toISOString(),
            branch: "",
            base: "",
            level,
            scope: scopeResult,
            results: {},
            summary: { total: 0, pass: 0, fail: 0, skip: 0, duration_ms: 0 },
          },
          null,
          2,
        ),
      );
    } else {
      console.log("\n  No showcase integrations affected by this change.\n");
    }
    await cleanup(worktreeDir, originalCwd, originalShowcaseDir);
    return;
  }

  if (!opts.json) {
    console.log(
      `\n  \x1b[36mEval scope:\x1b[0m ${scopeResult.slugs.join(", ")} (${scopeResult.mode})\n`,
    );
  }

  // -- 4. Baseline -----------------------------------------------------------
  const baselinePath = path.join(config.showcaseDir, ".eval-baseline.json");
  let baseline: EvalBaseline | null = null;

  if (opts.baseline === "compare") {
    baseline = loadBaseline(baselinePath);
    if (!baseline) {
      log.info("no local baseline, pulling from harness");
      try {
        baseline = await pullBaseline(undefined, baselinePath);
      } catch (err) {
        log.warn("failed to pull baseline", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      log.info("loaded local baseline", {
        slugCount: Object.keys(baseline.results).length,
      });
    }

    if (!baseline) {
      console.warn(
        "  \x1b[33mWarning: no baseline found for comparison, proceeding without\x1b[0m\n",
      );
    }
  }

  // -- 5. Build + start services ---------------------------------------------
  let autoStarted: string[] = [];

  if (opts.ci) {
    log.info("CI mode — skipping Docker lifecycle, assuming services running");
  } else {
    const slugsToStart = [...scopeResult.slugs];
    // Always ensure aimock is running
    if (!slugsToStart.includes("aimock")) {
      slugsToStart.push("aimock");
    }

    for (const slug of slugsToStart) {
      const running = await isRunning(slug);
      if (!running) {
        autoStarted.push(slug);
      }
    }

    if (autoStarted.length > 0) {
      if (!opts.json) {
        console.log(
          `  \x1b[36mStarting services:\x1b[0m ${autoStarted.join(", ")}`,
        );
      }
      // up() includes health checks internally
      await up(autoStarted);
      if (!opts.json) {
        console.log("  \x1b[32mAll services healthy\x1b[0m\n");
      }
    }
  }

  // -- 6-7. Run tiered tests -------------------------------------------------
  const healthySlugs = opts.ci
    ? [...scopeResult.slugs]
    : scopeResult.slugs.filter((s) => {
        try {
          const result = execFileSync(
            "docker",
            ["inspect", "--format={{.State.Health.Status}}", `showcase-${s}`],
            { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
          ).trim();
          return result === "healthy";
        } catch {
          return false;
        }
      });

  let tieredResult: TieredRunResult;

  try {
    const runOptions: RunOptions = {
      level,
      maxParallel: parallel,
      timeout,
      showcaseDir: config.showcaseDir,
      maxTier,
      noFailFast: !failFast,
      onSlugStart: (slug, tier) => {
        if (!opts.json)
          console.log(`  \x1b[2m[${tier}] testing ${slug}...\x1b[0m`);
      },
      onSlugComplete: (result, tier) => {
        const icon =
          result.status === "pass" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
        if (!opts.json)
          console.log(
            `  ${icon} [${tier}] ${result.slug} (${result.duration_ms}ms)`,
          );
      },
    };

    tieredResult = await runTiered(scopeResult.slugs, healthySlugs, runOptions);
  } catch (err) {
    console.error(
      `\x1b[31mEval run failed:\x1b[0m ${err instanceof Error ? err.message : String(err)}`,
    );
    await teardown(
      autoStarted,
      opts.keep,
      worktreeDir,
      originalCwd,
      originalShowcaseDir,
    );
    process.exit(1);
  }

  // -- 8. Collect results ----------------------------------------------------
  const branchName = (() => {
    try {
      return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf-8",
      }).trim();
    } catch {
      return opts.pr ? `PR #${opts.pr}` : (opts.branch ?? "unknown");
    }
  })();

  const evalResults: EvalResults = collectResults(tieredResult.results, {
    branch: branchName,
    base: "origin/main",
    level,
    scope: {
      mode: scopeResult.mode,
      reason: scopeResult.reason,
      slugs: scopeResult.slugs,
    },
  });

  // -- 9. Format + print -----------------------------------------------------
  // Adapt EvalBaseline to EvalResults for comparison. Both share the
  // `.results[slug][test].status` shape that computeRegressions/formatMatrix read.
  const baselineAsResults: EvalResults | undefined = baseline
    ? {
        version: baseline.version,
        timestamp: baseline.timestamp,
        branch: baseline.branch,
        base: baseline.base,
        level: baseline.level,
        scope: {
          mode: "all",
          reason: "baseline",
          slugs: Object.keys(baseline.results),
        },
        results: Object.fromEntries(
          Object.entries(baseline.results).map(([slug, tests]) => [
            slug,
            Object.fromEntries(
              Object.entries(tests).map(([testName, entry]) => [
                testName,
                {
                  status:
                    entry.status as import("./matrix.js").TestResult["status"],
                  duration_ms: 0,
                },
              ]),
            ),
          ]),
        ),
        summary: { ...baseline.summary, duration_ms: 0 },
      }
    : undefined;

  if (opts.json) {
    console.log(JSON.stringify(evalResults, null, 2));
  } else {
    const matrix = formatMatrix(evalResults, baselineAsResults ?? undefined);
    console.log(matrix);

    if (baseline && opts.baseline === "compare") {
      const regressions = computeRegressions(evalResults, baselineAsResults);
      if (regressions.count > 0) {
        console.log(
          `\n  \x1b[31mRegressions detected: ${regressions.count}\x1b[0m`,
        );
        for (const r of regressions.details) {
          console.log(`    - ${r.slug}: ${r.test}`);
        }
      }
    }

    const verdict = formatVerdict(evalResults, baselineAsResults ?? undefined);
    console.log(verdict);
  }

  // -- 10. Save results ------------------------------------------------------
  const savedPath = saveResults(evalResults, config.showcaseDir);
  log.info("results saved", { path: savedPath });

  if (opts.baseline === "capture") {
    const evalResultsDir = path.join(config.showcaseDir, ".eval-results");
    captureBaseline(evalResultsDir, baselinePath);
    log.info("baseline captured");
  }

  // -- 11. Cleanup -----------------------------------------------------------
  await teardown(
    autoStarted,
    opts.keep,
    worktreeDir,
    originalCwd,
    originalShowcaseDir,
  );

  // Exit with failure if any tests failed
  const totalFailed = evalResults.summary?.fail ?? 0;
  if (totalFailed > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function teardown(
  autoStarted: string[],
  keep: boolean | undefined,
  worktreeDir: string | null,
  originalCwd: string | null,
  showcaseDir: string,
): Promise<void> {
  if (!keep && autoStarted.length > 0) {
    log.info("stopping auto-started services", { services: autoStarted });
    try {
      await down(autoStarted);
    } catch (err) {
      log.warn("failed to stop services during teardown", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await cleanup(worktreeDir, originalCwd, showcaseDir);
}

async function cleanup(
  worktreeDir: string | null,
  originalCwd: string | null,
  showcaseDir: string,
): Promise<void> {
  if (worktreeDir && originalCwd) {
    process.chdir(originalCwd);
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktreeDir], {
        cwd: showcaseDir,
        stdio: "pipe",
        encoding: "utf-8",
      });
      log.info("worktree removed", { path: worktreeDir });
    } catch (err) {
      log.warn("failed to remove worktree", {
        path: worktreeDir,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
