/**
 * Eval parallel test runner with tier support.
 *
 * Unlike the existing CLI runner (which runs probe drivers in-process), this
 * runner spawns EXTERNAL processes (`showcase test <slug> --d5`) because each
 * integration's Playwright suite is separate. Results are collected from the
 * Playwright JSON reporter output on stdout.
 *
 * Tiers allow prioritized execution: Gold Standard integrations run first
 * with fail-fast semantics, then Key Partners, then the Full Matrix.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SlugResult, TestResult } from "./matrix.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { SlugResult } from "./matrix.js";

export interface TierConfig {
  name: string;
  slugs: string[] | "*";
  fail_fast: boolean;
}

export interface TiersFile {
  tiers: TierConfig[];
}

export interface RunOptions {
  level: string;
  maxParallel: number;
  timeout: number;
  showcaseDir: string;
  maxTier?: number;
  noFailFast?: boolean;
  onSlugStart?: (slug: string, tier: string) => void;
  onSlugComplete?: (result: SlugResult, tier: string) => void;
}

export interface TieredRunResult {
  results: SlugResult[];
  abortedAtTier?: number;
  tierSummaries: Array<{
    name: string;
    total: number;
    passed: number;
    failed: number;
    duration_ms: number;
  }>;
}

// ---------------------------------------------------------------------------
// Resolved tier (slugs always string[] after resolution)
// ---------------------------------------------------------------------------

interface ResolvedTier {
  name: string;
  slugs: string[];
  fail_fast: boolean;
}

// ---------------------------------------------------------------------------
// loadTiers
// ---------------------------------------------------------------------------

/**
 * Load tier configuration from a JSON file. Resolves the "*" wildcard by
 * filtering out slugs already named in previous tiers.
 *
 * If the file doesn't exist, returns a single "all" tier containing every slug.
 */
export function loadTiers(
  tiersPath: string,
  allSlugs: string[],
): ResolvedTier[] {
  let tiersFile: TiersFile;

  try {
    const raw = fs.readFileSync(tiersPath, "utf-8");
    tiersFile = JSON.parse(raw) as TiersFile;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [{ name: "all", slugs: [...allSlugs], fail_fast: false }];
    }
    throw err;
  }

  const claimedSlugs = new Set<string>();
  const resolved: ResolvedTier[] = [];

  for (const tier of tiersFile.tiers) {
    let slugs: string[];

    if (tier.slugs === "*") {
      // Wildcard: all slugs not already claimed by previous tiers
      slugs = allSlugs.filter((s) => !claimedSlugs.has(s));
    } else {
      slugs = tier.slugs.filter((s) => allSlugs.includes(s));
    }

    for (const s of slugs) {
      claimedSlugs.add(s);
    }

    resolved.push({
      name: tier.name,
      slugs,
      fail_fast: tier.fail_fast,
    });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// runSlug
// ---------------------------------------------------------------------------

/**
 * Spawn `npx tsx harness/src/cli.ts test <slug> --level <level>` with
 * Playwright JSON reporter injected via `--reporter=list,json` and
 * `PLAYWRIGHT_JSON_OUTPUT_NAME`. Reads the JSON file after exit for
 * per-test granularity; falls back to stdout, then to exit-code.
 */
export async function runSlug(
  slug: string,
  level: string,
  timeout: number,
  showcaseDir: string,
): Promise<SlugResult> {
  const startMs = Date.now();
  const jsonOutputPath = path.join(
    os.tmpdir(),
    `eval-${slug}-${Date.now()}.json`,
  );

  return new Promise<SlugResult>((resolve) => {
    const args = [
      "tsx",
      "harness/src/cli.ts",
      "test",
      slug,
      "--level",
      level,
      "--",
      "--reporter=list,json",
    ];

    execFile(
      "npx",
      args,
      {
        cwd: showcaseDir,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf-8",
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOutputPath },
      },
      (err: Error | null, stdout: string, _stderr: string) => {
        const durationMs = Date.now() - startMs;

        let fileJson: string | null = null;
        try {
          fileJson = fs.readFileSync(jsonOutputPath, "utf-8");
          fs.unlinkSync(jsonOutputPath);
        } catch {
          // File doesn't exist — Playwright didn't write it
        }

        const exitedWithError = !!err;
        const parsed =
          tryParsePlaywrightJson(fileJson) ?? tryParsePlaywrightJson(stdout);

        if (parsed) {
          resolve({
            slug,
            status: parsed.hasFailures ? "fail" : "pass",
            tests: parsed.tests,
            duration_ms: durationMs,
          });
          return;
        }

        resolve({
          slug,
          status: exitedWithError ? "fail" : "pass",
          tests: {},
          duration_ms: durationMs,
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Playwright JSON parsing
// ---------------------------------------------------------------------------

interface ParsedPlaywright {
  tests: Record<string, TestResult>;
  hasFailures: boolean;
}

/**
 * Normalize Playwright test statuses to the vocabulary expected by the
 * matrix module ("pass", "fail", "error", "skip").
 */
function normalizeStatus(pwStatus: string): TestResult["status"] {
  if (pwStatus === "passed") return "pass";
  if (pwStatus === "failed") return "fail";
  if (pwStatus === "timedOut") return "error";
  if (pwStatus === "skipped") return "skip";
  if (pwStatus === "interrupted") return "error";
  return "error";
}

/**
 * Try to parse Playwright JSON reporter output from stdout. Returns null
 * if parsing fails. Handles the nested suites/specs/tests structure.
 */
function tryParsePlaywrightJson(
  stdout: string | null,
): ParsedPlaywright | null {
  if (!stdout) return null;
  try {
    const data = JSON.parse(stdout) as {
      suites?: Array<{
        title: string;
        specs?: Array<{
          title: string;
          tests?: Array<{
            results?: Array<{
              status: string;
              duration: number;
              error?: { message?: string };
            }>;
          }>;
        }>;
        suites?: Array<unknown>;
      }>;
    };

    if (!data.suites) return null;

    const tests: Record<string, TestResult> = {};
    let hasFailures = false;

    function walkSuites(
      suites: Array<{
        title: string;
        specs?: Array<{
          title: string;
          tests?: Array<{
            results?: Array<{
              status: string;
              duration: number;
              error?: { message?: string };
            }>;
          }>;
        }>;
        suites?: Array<unknown>;
      }>,
      parentTitle?: string,
    ): void {
      for (const suite of suites) {
        const suiteTitle = parentTitle
          ? `${parentTitle} > ${suite.title}`
          : suite.title;

        if (suite.specs) {
          for (const spec of suite.specs) {
            if (spec.tests) {
              for (const test of spec.tests) {
                if (test.results && test.results.length > 0) {
                  const lastResult = test.results[test.results.length - 1];
                  const normalized = normalizeStatus(lastResult.status);
                  const entry: TestResult = {
                    status: normalized,
                    duration_ms: lastResult.duration,
                  };

                  if (lastResult.error?.message) {
                    entry.error = lastResult.error.message;
                  }

                  if (normalized === "fail" || normalized === "error") {
                    hasFailures = true;
                  }

                  tests[`${suiteTitle} > ${spec.title}`] = entry;
                }
              }
            }
          }
        }

        // Recurse into nested suites
        if (suite.suites) {
          walkSuites(
            suite.suites as Array<{
              title: string;
              specs?: Array<{
                title: string;
                tests?: Array<{
                  results?: Array<{
                    status: string;
                    duration: number;
                    error?: { message?: string };
                  }>;
                }>;
              }>;
              suites?: Array<unknown>;
            }>,
            suiteTitle,
          );
        }
      }
    }

    walkSuites(data.suites);
    return { tests, hasFailures };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// runParallel
// ---------------------------------------------------------------------------

/**
 * Run slugs in parallel with bounded concurrency using a Promise-based
 * semaphore pattern.
 */
export async function runParallel(
  slugs: string[],
  opts: RunOptions,
): Promise<SlugResult[]> {
  const results: SlugResult[] = [];
  const executing = new Set<Promise<void>>();

  for (const slug of slugs) {
    opts.onSlugStart?.(slug, "");

    const p = runSlug(slug, opts.level, opts.timeout, opts.showcaseDir)
      .then((r) => {
        results.push(r);
        opts.onSlugComplete?.(r, "");
      })
      .finally(() => executing.delete(p));
    executing.add(p);

    if (executing.size >= opts.maxParallel) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

// ---------------------------------------------------------------------------
// runTiered
// ---------------------------------------------------------------------------

/**
 * Execute tiers in sequence. Tier 1 runs with maxParallel=1 for fast feedback.
 * After each tier, checks fail_fast + failure count; if fail_fast and any
 * failures, stops the run.
 *
 * `healthySlugs` filters the tier slugs — only healthy slugs are run, the
 * rest are marked "unhealthy".
 */
export async function runTiered(
  allSlugs: string[],
  healthySlugs: string[],
  opts: RunOptions,
): Promise<TieredRunResult> {
  const tiersPath = `${opts.showcaseDir}/eval-tiers.json`;
  const tiers = loadTiers(tiersPath, allSlugs);

  const healthySet = new Set(healthySlugs);
  const allResults: SlugResult[] = [];
  const tierSummaries: TieredRunResult["tierSummaries"] = [];
  let abortedAtTier: number | undefined;

  const maxTier = opts.maxTier ?? tiers.length;

  for (let i = 0; i < Math.min(tiers.length, maxTier); i++) {
    const tier = tiers[i];
    const tierStart = Date.now();

    // Filter to only healthy slugs for this tier
    const runnableSlugs = tier.slugs.filter((s) => healthySet.has(s));
    const unhealthySlugs = tier.slugs.filter((s) => !healthySet.has(s));

    // Mark unhealthy slugs as such
    for (const slug of unhealthySlugs) {
      allResults.push({
        slug,
        status: "unhealthy",
        tests: {},
        duration_ms: 0,
      });
    }

    // Tier 1 runs with maxParallel=1 for fast feedback
    const tierParallel = i === 0 ? 1 : opts.maxParallel;

    const tierOpts: RunOptions = {
      ...opts,
      maxParallel: tierParallel,
      onSlugStart: (slug) => opts.onSlugStart?.(slug, tier.name),
      onSlugComplete: (result) => opts.onSlugComplete?.(result, tier.name),
    };

    const tierResults = await runParallel(runnableSlugs, tierOpts);
    allResults.push(...tierResults);

    const passed = tierResults.filter((r) => r.status === "pass").length;
    const failed = tierResults.filter(
      (r) => r.status === "fail" || r.status === "error",
    ).length;

    tierSummaries.push({
      name: tier.name,
      total: tier.slugs.length,
      passed,
      failed,
      duration_ms: Date.now() - tierStart,
    });

    // Check fail-fast: if this tier has fail_fast and there are failures, abort
    if (tier.fail_fast && !opts.noFailFast && failed > 0) {
      abortedAtTier = i;
      break;
    }
  }

  return {
    results: allResults,
    abortedAtTier,
    tierSummaries,
  };
}
