/**
 * Eval matrix reporting module — aggregates per-slug eval results into a
 * consolidated report, formats a coloured terminal matrix with delta markers
 * (FIXED / NEW) against a baseline, and computes regression counts.
 *
 * Uses the same ANSI colour constants as ../results.ts.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// ANSI helpers (mirrored from ../results.ts)
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalResults {
  version: number;
  timestamp: string;
  branch: string;
  base: string;
  level: string;
  scope: { mode: string; reason: string; slugs: string[] };
  results: Record<string, Record<string, TestResult>>;
  summary: {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    duration_ms: number;
  };
}

export interface TestResult {
  status: "pass" | "fail" | "skip" | "error" | "build_failed" | "unhealthy";
  duration_ms?: number;
  error?: string;
}

export interface SlugResult {
  slug: string;
  status: "pass" | "fail" | "error" | "build_failed" | "unhealthy" | "skipped";
  tests: Record<string, TestResult>;
  duration_ms: number;
}

export interface EvalMetadata {
  branch: string;
  base: string;
  level: string;
  scope: { mode: string; reason: string; slugs: string[] };
}

// ---------------------------------------------------------------------------
// collectResults
// ---------------------------------------------------------------------------

/**
 * Aggregate per-slug results into consolidated EvalResults format.
 * Slugs whose status is build_failed or unhealthy with no tests get a
 * synthetic test entry so they still appear in the matrix.
 */
export function collectResults(
  slugResults: SlugResult[],
  metadata: EvalMetadata,
): EvalResults {
  const results: Record<string, Record<string, TestResult>> = {};
  let totalDuration = 0;

  for (const sr of slugResults) {
    const tests = { ...sr.tests };

    // Synthetic entry for slugs that never ran tests
    if (Object.keys(tests).length === 0) {
      const syntheticStatus = sr.status === "skipped" ? "skip" : sr.status;
      tests["_status"] = {
        status: syntheticStatus as TestResult["status"],
        duration_ms: sr.duration_ms,
      };
    }

    results[sr.slug] = tests;
    totalDuration += sr.duration_ms;
  }

  // Compute summary from all test entries
  const allTests = Object.values(results).flatMap((t) => Object.values(t));
  const pass = allTests.filter((t) => t.status === "pass").length;
  const skip = allTests.filter((t) => t.status === "skip").length;
  const fail = allTests.length - pass - skip;

  return {
    version: 1,
    timestamp: new Date().toISOString(),
    branch: metadata.branch,
    base: metadata.base,
    level: metadata.level,
    scope: metadata.scope,
    results,
    summary: {
      total: allTests.length,
      pass,
      fail,
      skip,
      duration_ms: totalDuration,
    },
  };
}

// ---------------------------------------------------------------------------
// computeRegressions
// ---------------------------------------------------------------------------

/**
 * Count pass->fail transitions between baseline and current results.
 * Only pass->fail in the baseline is counted as a regression. fail->fail,
 * skip->fail, and new tests are not regressions.
 */
export function computeRegressions(
  results: EvalResults,
  baseline?: EvalResults,
): { count: number; details: Array<{ slug: string; test: string }> } {
  if (!baseline) {
    return { count: 0, details: [] };
  }

  const details: Array<{ slug: string; test: string }> = [];

  for (const [slug, tests] of Object.entries(results.results)) {
    const baselineTests = baseline.results[slug];
    if (!baselineTests) continue;

    for (const [testName, testResult] of Object.entries(tests)) {
      const baselineTest = baselineTests[testName];
      if (!baselineTest) continue;

      // Only pass->fail is a regression
      if (baselineTest.status === "pass" && testResult.status !== "pass") {
        details.push({ slug, test: testName });
      }
    }
  }

  return { count: details.length, details };
}

// ---------------------------------------------------------------------------
// formatMatrix
// ---------------------------------------------------------------------------

function statusColor(status: TestResult["status"]): string {
  if (status === "pass") return GREEN;
  if (status === "skip") return YELLOW;
  return RED;
}

function statusIcon(status: TestResult["status"]): string {
  if (status === "pass") return "✓";
  if (status === "skip") return "-";
  return "✗";
}

/**
 * Format a coloured terminal matrix showing per-slug results with optional
 * delta markers against a baseline.
 */
export function formatMatrix(
  results: EvalResults,
  baseline?: EvalResults,
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `  ${DIM}Eval Matrix${RESET}  ${results.branch} vs ${results.base}  ${DIM}(${results.level})${RESET}`,
  );
  lines.push(`  ${DIM}${"─".repeat(60)}${RESET}`);

  const slugs = Object.keys(results.results).sort();

  for (const slug of slugs) {
    const tests = results.results[slug];
    const testNames = Object.keys(tests).sort();
    const slugPass = Object.values(tests).filter(
      (t) => t.status === "pass",
    ).length;
    const slugTotal = testNames.length;
    const slugColor = slugPass === slugTotal ? GREEN : RED;

    lines.push(
      `  ${slugColor}${slug}${RESET}  ${DIM}(${slugPass}/${slugTotal})${RESET}`,
    );

    for (const testName of testNames) {
      const test = tests[testName];
      const icon = statusIcon(test.status);
      const color = statusColor(test.status);

      let delta = "";
      if (baseline) {
        const baselineTest = baseline.results[slug]?.[testName];
        if (baselineTest) {
          if (baselineTest.status !== "pass" && test.status === "pass") {
            delta = ` ${GREEN}[FIXED]${RESET}`;
          } else if (baselineTest.status === "pass" && test.status !== "pass") {
            delta = ` ${RED}[NEW]${RESET}`;
          }
        }
      }

      const duration = test.duration_ms
        ? ` ${DIM}(${(test.duration_ms / 1000).toFixed(1)}s)${RESET}`
        : "";
      const errorStr = test.error ? `  ${RED}${test.error}${RESET}` : "";

      lines.push(
        `    ${color}${icon}${RESET} ${testName} ${color}${test.status}${RESET}${duration}${delta}${errorStr}`,
      );
    }
  }

  // Summary
  lines.push(`  ${DIM}${"─".repeat(60)}${RESET}`);
  const { pass, fail, skip } = results.summary;
  const parts: string[] = [];
  parts.push(`${GREEN}${pass} passed${RESET}`);
  if (fail > 0) parts.push(`${RED}${fail} failed${RESET}`);
  if (skip > 0) parts.push(`${YELLOW}${skip} skipped${RESET}`);
  const durationStr = `${DIM}(${(results.summary.duration_ms / 1000).toFixed(1)}s)${RESET}`;
  lines.push(`  ${parts.join(", ")} ${durationStr}`);

  // If no failures, still show "0 passed" for empty case
  if (pass === 0 && fail === 0 && skip === 0) {
    lines[lines.length - 1] = `  ${GREEN}0 passed${RESET} ${durationStr}`;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatVerdict
// ---------------------------------------------------------------------------

/**
 * Return a coloured verdict line — SAFE TO MERGE or REGRESSIONS DETECTED.
 */
export function formatVerdict(
  results: EvalResults,
  baseline?: EvalResults,
): string {
  const { count, details } = computeRegressions(results, baseline);
  if (count === 0) {
    return `\n  ${GREEN}✓ SAFE TO MERGE${RESET}  ${DIM}(0 regressions)${RESET}\n`;
  }

  const lines: string[] = [];
  lines.push(
    `\n  ${RED}✗ REGRESSIONS DETECTED${RESET}  ${RED}(${count} regression${count > 1 ? "s" : ""})${RESET}`,
  );
  for (const d of details) {
    lines.push(`    ${RED}✗${RESET} ${d.slug} / ${d.test}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// saveResults
// ---------------------------------------------------------------------------

/**
 * Write eval results to .eval-results/<timestamp>.json under the given
 * showcase directory. Returns the absolute path to the written file.
 */
export function saveResults(results: EvalResults, showcaseDir: string): string {
  const dir = path.join(showcaseDir, ".eval-results");
  fs.mkdirSync(dir, { recursive: true });

  // Timestamp-based filename, safe for filesystem
  const ts = results.timestamp.replace(/[:.]/g, "-");
  const filePath = path.join(dir, `${ts}.json`);

  fs.writeFileSync(filePath, JSON.stringify(results, null, 2) + "\n", "utf-8");
  return filePath;
}
