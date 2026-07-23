import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  collectResults,
  computeRegressions,
  formatMatrix,
  formatVerdict,
  saveResults,
  type EvalResults,
  type SlugResult,
  type EvalMetadata,
  type TestResult,
} from "./matrix.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(overrides: Partial<EvalMetadata> = {}): EvalMetadata {
  return {
    branch: "feat/test",
    base: "main",
    level: "smoke",
    scope: { mode: "full", reason: "ci", slugs: ["slug-a", "slug-b"] },
    ...overrides,
  };
}

function makeSlugResult(
  slug: string,
  status: SlugResult["status"],
  tests: Record<string, TestResult> = {},
  duration_ms = 1000,
): SlugResult {
  return { slug, status, tests, duration_ms };
}

function makeEvalResults(
  results: Record<string, Record<string, TestResult>>,
  summary?: Partial<EvalResults["summary"]>,
): EvalResults {
  const allTests = Object.values(results).flatMap((t) => Object.values(t));
  return {
    version: 1,
    timestamp: "2026-04-29T12:00:00.000Z",
    branch: "feat/test",
    base: "main",
    level: "smoke",
    scope: { mode: "full", reason: "ci", slugs: Object.keys(results) },
    results,
    summary: {
      total: allTests.length,
      pass: allTests.filter((t) => t.status === "pass").length,
      fail: allTests.filter((t) => t.status !== "pass" && t.status !== "skip")
        .length,
      skip: allTests.filter((t) => t.status === "skip").length,
      duration_ms: 5000,
      ...summary,
    },
  };
}

// ---------------------------------------------------------------------------
// collectResults
// ---------------------------------------------------------------------------

describe("collectResults", () => {
  it("aggregates per-slug results into consolidated JSON", () => {
    const slugs: SlugResult[] = [
      makeSlugResult("slug-a", "pass", {
        smoke: { status: "pass", duration_ms: 100 },
        liveness: { status: "pass", duration_ms: 200 },
      }),
      makeSlugResult("slug-b", "fail", {
        smoke: { status: "pass", duration_ms: 150 },
        liveness: { status: "fail", duration_ms: 300, error: "timeout" },
      }),
    ];
    const meta = makeMetadata();
    const result = collectResults(slugs, meta);

    expect(result.version).toBe(1);
    expect(result.branch).toBe("feat/test");
    expect(result.base).toBe("main");
    expect(result.level).toBe("smoke");
    expect(result.scope).toEqual(meta.scope);
    expect(result.results["slug-a"]).toBeDefined();
    expect(result.results["slug-b"]).toBeDefined();
    expect(result.results["slug-a"]["smoke"].status).toBe("pass");
    expect(result.results["slug-b"]["liveness"].status).toBe("fail");
    expect(result.summary.total).toBe(4);
    expect(result.summary.pass).toBe(3);
    expect(result.summary.fail).toBe(1);
    expect(result.summary.skip).toBe(0);
    expect(result.summary.duration_ms).toBe(2000);
    expect(result.timestamp).toBeTruthy();
  });

  it("handles slugs with build_failed status", () => {
    const slugs: SlugResult[] = [
      makeSlugResult("slug-a", "build_failed", {}, 500),
    ];
    const result = collectResults(slugs, makeMetadata());

    expect(result.results["slug-a"]).toBeDefined();
    // build_failed slug gets a synthetic test entry
    const tests = Object.values(result.results["slug-a"]);
    expect(tests.some((t) => t.status === "build_failed")).toBe(true);
    expect(result.summary.fail).toBeGreaterThanOrEqual(1);
  });

  it("handles slugs with unhealthy status", () => {
    const slugs: SlugResult[] = [
      makeSlugResult("slug-a", "unhealthy", {}, 500),
    ];
    const result = collectResults(slugs, makeMetadata());

    expect(result.results["slug-a"]).toBeDefined();
    const tests = Object.values(result.results["slug-a"]);
    expect(tests.some((t) => t.status === "unhealthy")).toBe(true);
    expect(result.summary.fail).toBeGreaterThanOrEqual(1);
  });

  it("computes correct summary totals", () => {
    const slugs: SlugResult[] = [
      makeSlugResult("slug-a", "pass", {
        smoke: { status: "pass", duration_ms: 100 },
        liveness: { status: "pass", duration_ms: 200 },
      }),
      makeSlugResult("slug-b", "fail", {
        smoke: { status: "fail", duration_ms: 150 },
        liveness: { status: "skip" },
      }),
      makeSlugResult("slug-c", "pass", {
        smoke: { status: "pass", duration_ms: 100 },
      }),
    ];
    const result = collectResults(slugs, makeMetadata());

    expect(result.summary.total).toBe(5);
    expect(result.summary.pass).toBe(3);
    expect(result.summary.fail).toBe(1);
    expect(result.summary.skip).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatMatrix
// ---------------------------------------------------------------------------

describe("formatMatrix", () => {
  // Strip ANSI codes for easier assertion
  function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "");
  }

  it("produces correct pass/fail counts in summary", () => {
    const results = makeEvalResults({
      "slug-a": {
        smoke: { status: "pass", duration_ms: 100 },
        liveness: { status: "pass", duration_ms: 200 },
      },
      "slug-b": {
        smoke: { status: "fail", duration_ms: 150, error: "timeout" },
        liveness: { status: "pass", duration_ms: 300 },
      },
    });

    const output = stripAnsi(formatMatrix(results));
    expect(output).toContain("3 passed");
    expect(output).toContain("1 failed");
  });

  it("shows FIXED markers when baseline has fail and current has pass", () => {
    const baseline = makeEvalResults({
      "slug-a": {
        smoke: { status: "fail", duration_ms: 100 },
      },
    });
    const current = makeEvalResults({
      "slug-a": {
        smoke: { status: "pass", duration_ms: 100 },
      },
    });

    const output = stripAnsi(formatMatrix(current, baseline));
    expect(output).toContain("FIXED");
  });

  it("shows NEW markers when baseline has pass and current has fail", () => {
    const baseline = makeEvalResults({
      "slug-a": {
        smoke: { status: "pass", duration_ms: 100 },
      },
    });
    const current = makeEvalResults({
      "slug-a": {
        smoke: { status: "fail", duration_ms: 100, error: "broke" },
      },
    });

    const output = stripAnsi(formatMatrix(current, baseline));
    expect(output).toContain("NEW");
  });

  it("handles missing baseline (no delta markers, just raw results)", () => {
    const results = makeEvalResults({
      "slug-a": {
        smoke: { status: "pass", duration_ms: 100 },
      },
    });

    const output = stripAnsi(formatMatrix(results));
    expect(output).not.toContain("FIXED");
    expect(output).not.toContain("NEW");
    expect(output).toContain("slug-a");
  });

  it("handles empty results gracefully", () => {
    const results = makeEvalResults({});
    const output = stripAnsi(formatMatrix(results));
    expect(output).toContain("0 passed");
    // Should not throw
    expect(typeof output).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// computeRegressions
// ---------------------------------------------------------------------------

describe("computeRegressions", () => {
  it("returns 0 when no baseline", () => {
    const results = makeEvalResults({
      "slug-a": {
        smoke: { status: "fail", duration_ms: 100 },
      },
    });
    const { count, details } = computeRegressions(results);
    expect(count).toBe(0);
    expect(details).toEqual([]);
  });

  it("returns 0 when all stable", () => {
    const baseline = makeEvalResults({
      "slug-a": {
        smoke: { status: "pass", duration_ms: 100 },
      },
    });
    const current = makeEvalResults({
      "slug-a": {
        smoke: { status: "pass", duration_ms: 100 },
      },
    });
    const { count } = computeRegressions(current, baseline);
    expect(count).toBe(0);
  });

  it("returns count of pass->fail transitions", () => {
    const baseline = makeEvalResults({
      "slug-a": {
        smoke: { status: "pass", duration_ms: 100 },
        liveness: { status: "pass", duration_ms: 200 },
      },
    });
    const current = makeEvalResults({
      "slug-a": {
        smoke: { status: "fail", duration_ms: 100 },
        liveness: { status: "fail", duration_ms: 200 },
      },
    });
    const { count, details } = computeRegressions(current, baseline);
    expect(count).toBe(2);
    expect(details).toEqual([
      { slug: "slug-a", test: "smoke" },
      { slug: "slug-a", test: "liveness" },
    ]);
  });

  it("does not count fail->fail as regression", () => {
    const baseline = makeEvalResults({
      "slug-a": {
        smoke: { status: "fail", duration_ms: 100 },
      },
    });
    const current = makeEvalResults({
      "slug-a": {
        smoke: { status: "fail", duration_ms: 100 },
      },
    });
    const { count } = computeRegressions(current, baseline);
    expect(count).toBe(0);
  });

  it("does not count skip->fail as regression", () => {
    const baseline = makeEvalResults({
      "slug-a": {
        smoke: { status: "skip" },
      },
    });
    const current = makeEvalResults({
      "slug-a": {
        smoke: { status: "fail", duration_ms: 100 },
      },
    });
    const { count } = computeRegressions(current, baseline);
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatVerdict
// ---------------------------------------------------------------------------

describe("formatVerdict", () => {
  function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "");
  }

  it("returns SAFE TO MERGE when zero regressions", () => {
    const results = makeEvalResults({
      "slug-a": { smoke: { status: "pass", duration_ms: 100 } },
    });
    const verdict = stripAnsi(formatVerdict(results));
    expect(verdict).toContain("SAFE TO MERGE");
  });

  it("returns REGRESSIONS DETECTED when >0 regressions", () => {
    const baseline = makeEvalResults({
      "slug-a": { smoke: { status: "pass", duration_ms: 100 } },
    });
    const current = makeEvalResults({
      "slug-a": { smoke: { status: "fail", duration_ms: 100 } },
    });
    const verdict = stripAnsi(formatVerdict(current, baseline));
    expect(verdict).toContain("REGRESSIONS DETECTED");
  });
});

// ---------------------------------------------------------------------------
// saveResults
// ---------------------------------------------------------------------------

describe("saveResults", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-matrix-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes results to .eval-results/<timestamp>.json and returns path", () => {
    const results = makeEvalResults({
      "slug-a": { smoke: { status: "pass", duration_ms: 100 } },
    });

    const filePath = saveResults(results, tmpDir);
    expect(filePath).toContain(".eval-results");
    expect(filePath).toMatch(/\.json$/);
    expect(fs.existsSync(filePath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(written.version).toBe(1);
    expect(written.results["slug-a"]).toBeDefined();
  });
});
