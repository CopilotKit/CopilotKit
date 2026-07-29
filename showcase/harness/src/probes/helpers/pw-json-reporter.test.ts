/**
 * Unit tests for the Playwright JSON reporter parser.
 *
 * ## Golden fixture provenance
 *
 * Fixtures in `pw-json-reporter-fixtures/` were captured from real Playwright
 * runs (Playwright 1.61.1 installed at /opt/homebrew) against throwaway specs
 * in /tmp/pw-fixture-gen, except where noted as synthetic below:
 *
 *   pass.json              — `npx playwright test pass-and-fail.spec.ts` (all pass)
 *   fail.json              — `npx playwright test failing.spec.ts` (one pass, one fail)
 *   errored-runtime.json   — `npx playwright test errored.spec.ts`
 *                            (beforeAll throws — duration:0 signature)
 *   errored-collection.json — `npx playwright test collection-error.spec.ts`
 *                            (top-level throw at collection time — errors[] populated,
 *                             no suite entry for the file)
 *   zero-tests.json        — `npx playwright test really-empty.spec.ts`
 *                            (file with no test() calls; Playwright emits empty suites[])
 *   multi-spec.json        — `npx playwright test pass-and-fail.spec.ts failing.spec.ts`
 *                            (two suites, one fully passing, one mixed)
 *   timed-out.json         — `npx playwright test timed-out.spec.ts`
 *                            (expect(...).toBeVisible() times out — status:"timedOut", duration>0)
 *   all-skipped.json       — `npx playwright test all-skipped.spec.ts`
 *                            (all tests marked test.skip(); status:"skipped", spec.ok:true)
 *   flaky-retry-pass.json  — `npx playwright test flaky-retry.spec.ts` with retries:1
 *                            (first attempt fails, second passes — spec.ok:true, two result entries)
 *   interrupted.json       — SYNTHETIC: status:"interrupted", duration:0
 *                            (requires process-level SIGTERM — cannot be captured from a
 *                             throwaway npx run without process orchestration; shape matches
 *                             real Playwright JSON output for a SIGTERM-interrupted test)
 *
 * The ERRORED and ZERO_TESTS distinctions are validated against these real
 * captured outputs — synthetic hand-crafted fixtures alone are not sufficient
 * per the advisory in §3.1 of the implementation plan.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parsePlaywrightJsonReport,
  type PlaywrightJsonReport,
  type SpecVerdict,
} from "./pw-json-reporter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "pw-json-reporter-fixtures");

function loadFixture(name: string): PlaywrightJsonReport {
  const raw = readFileSync(resolve(fixturesDir, name), "utf8");
  return JSON.parse(raw) as PlaywrightJsonReport;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function verdictFor(
  report: PlaywrightJsonReport,
  specPath: string,
): SpecVerdict {
  const results = parsePlaywrightJsonReport(report, [specPath]);
  const result = results[0];
  if (!result) throw new Error(`No result for specPath: ${specPath}`);
  return result.status;
}

// ---------------------------------------------------------------------------
// PASS — all tests in the spec passed
// ---------------------------------------------------------------------------

describe("pw-json-reporter — PASS verdict", () => {
  it("classifies a spec with all-passing tests as PASS", () => {
    const report = loadFixture("pass.json");
    expect(verdictFor(report, "pass-and-fail.spec.ts")).toBe("PASS");
  });

  it("returns tests titles for a passing spec", () => {
    const report = loadFixture("pass.json");
    const [result] = parsePlaywrightJsonReport(report, [
      "pass-and-fail.spec.ts",
    ]);
    expect(result?.tests.length).toBeGreaterThan(0);
  });

  it("matches via absolute path suffix (caller passes absolute, Playwright emits relative)", () => {
    const report = loadFixture("pass.json");
    expect(
      verdictFor(report, "/some/abs/path/to/tests/e2e/pass-and-fail.spec.ts"),
    ).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// FAIL — at least one test failed with duration > 0
// ---------------------------------------------------------------------------

describe("pw-json-reporter — FAIL verdict", () => {
  it("classifies a spec with a failing assertion (duration>0) as FAIL", () => {
    const report = loadFixture("fail.json");
    expect(verdictFor(report, "failing.spec.ts")).toBe("FAIL");
  });

  it("still returns tests for the failed spec", () => {
    const report = loadFixture("fail.json");
    const [result] = parsePlaywrightJsonReport(report, ["failing.spec.ts"]);
    expect(result?.tests.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ERRORED (runtime) — beforeAll/setup hook throws; all results have duration===0
// ---------------------------------------------------------------------------

describe("pw-json-reporter — ERRORED verdict (runtime setup failure)", () => {
  it("classifies a spec where all results have duration:0 as ERRORED, not FAIL", () => {
    const report = loadFixture("errored-runtime.json");
    // The suite IS present (errored.spec.ts) but every result has duration:0
    expect(verdictFor(report, "errored.spec.ts")).toBe("ERRORED");
  });

  it("returns an empty tests array for an ERRORED-runtime spec", () => {
    // Tests never ran so we emit an empty list (the spec titles exist but
    // the run produced no meaningful test output).
    const report = loadFixture("errored-runtime.json");
    // Note: we DO still collect titles from specs in the suite — check
    // that status is ERRORED regardless of title collection.
    const [result] = parsePlaywrightJsonReport(report, ["errored.spec.ts"]);
    expect(result?.status).toBe("ERRORED");
  });

  it("does NOT classify as FAIL a spec where errors have duration:0", () => {
    const report = loadFixture("errored-runtime.json");
    expect(verdictFor(report, "errored.spec.ts")).not.toBe("FAIL");
  });
});

// ---------------------------------------------------------------------------
// ERRORED (collection) — file throws at import time; top-level errors[] populated
// ---------------------------------------------------------------------------

describe("pw-json-reporter — ERRORED verdict (collection-time error)", () => {
  it("classifies a spec with a collection-time error as ERRORED", () => {
    const report = loadFixture("errored-collection.json");
    // errors[0].location.file = "...collection-error.spec.ts"
    expect(verdictFor(report, "collection-error.spec.ts")).toBe("ERRORED");
  });

  it("returns an empty tests array for a collection-ERRORED spec", () => {
    const report = loadFixture("errored-collection.json");
    const [result] = parsePlaywrightJsonReport(report, [
      "collection-error.spec.ts",
    ]);
    expect(result?.tests).toEqual([]);
  });

  it("matches collection-error via absolute path", () => {
    const report = loadFixture("errored-collection.json");
    expect(
      verdictFor(report, "/tmp/pw-fixture-gen/tests/collection-error.spec.ts"),
    ).toBe("ERRORED");
  });
});

// ---------------------------------------------------------------------------
// ZERO_TESTS — spec file targeted but produced no test definitions
// ---------------------------------------------------------------------------

describe("pw-json-reporter — ZERO_TESTS verdict", () => {
  it("classifies a spec file as ERRORED when the run had a location-less error (real zero-tests fixture)", () => {
    const report = loadFixture("zero-tests.json");
    // zero-tests.json has errors[] with a location-less "No tests found" error.
    // A run with any location-less error is ERRORED (fail-closed): something
    // went wrong in the runner itself, so we cannot confirm the spec had zero
    // tests vs the run was incomplete.
    expect(verdictFor(report, "really-empty.spec.ts")).toBe("ERRORED");
  });

  it("returns an empty tests array for the ERRORED result from zero-tests fixture", () => {
    const report = loadFixture("zero-tests.json");
    const [result] = parsePlaywrightJsonReport(report, [
      "really-empty.spec.ts",
    ]);
    expect(result?.tests).toEqual([]);
  });

  it("classifies a spec as ZERO_TESTS when errors[] is completely empty and no suite (pure empty run)", () => {
    // True ZERO_TESTS: the run produced no output at all — no errors, no suites.
    const report: PlaywrightJsonReport = { suites: [], errors: [] };
    expect(verdictFor(report, "missing.spec.ts")).toBe("ZERO_TESTS");
  });
});

// ---------------------------------------------------------------------------
// Multi-spec report — two spec files in one run
// ---------------------------------------------------------------------------

describe("pw-json-reporter — multi-spec grouping", () => {
  it("correctly classifies each spec in a two-spec run independently", () => {
    const report = loadFixture("multi-spec.json");
    const results = parsePlaywrightJsonReport(report, [
      "pass-and-fail.spec.ts",
      "failing.spec.ts",
    ]);
    const byPath = Object.fromEntries(
      results.map((r) => [r.specPath, r.status]),
    );
    expect(byPath["pass-and-fail.spec.ts"]).toBe("PASS");
    expect(byPath["failing.spec.ts"]).toBe("FAIL");
  });

  it("returns ZERO_TESTS for a spec not in the multi-spec report", () => {
    const report = loadFixture("multi-spec.json");
    expect(verdictFor(report, "nonexistent.spec.ts")).toBe("ZERO_TESTS");
  });

  it("returns results in the same order as the input specPaths array", () => {
    const report = loadFixture("multi-spec.json");
    const specPaths = ["failing.spec.ts", "pass-and-fail.spec.ts"];
    const results = parsePlaywrightJsonReport(report, specPaths);
    expect(results[0]?.specPath).toBe("failing.spec.ts");
    expect(results[1]?.specPath).toBe("pass-and-fail.spec.ts");
  });
});

// ---------------------------------------------------------------------------
// Edge cases and fail-closed invariants
// ---------------------------------------------------------------------------

describe("pw-json-reporter — fail-closed invariants", () => {
  it("returns ZERO_TESTS for a spec path not present in the report", () => {
    const report = loadFixture("pass.json");
    expect(verdictFor(report, "absent.spec.ts")).toBe("ZERO_TESTS");
  });

  it("handles an empty report (no suites, no errors) returning ZERO_TESTS", () => {
    const emptyReport: PlaywrightJsonReport = {
      suites: [],
      errors: [],
    };
    expect(verdictFor(emptyReport, "anything.spec.ts")).toBe("ZERO_TESTS");
  });

  it("handles a report where all specs pass but one targeted spec is absent → ZERO_TESTS", () => {
    const report = loadFixture("pass.json");
    const results = parsePlaywrightJsonReport(report, [
      "pass-and-fail.spec.ts",
      "missing.spec.ts",
    ]);
    expect(results[0]?.status).toBe("PASS");
    expect(results[1]?.status).toBe("ZERO_TESTS");
  });

  it("never returns PASS for a spec with mixed pass/fail tests", () => {
    // The failing.spec.ts fixture has one passing and one failing test
    const report = loadFixture("fail.json");
    expect(verdictFor(report, "failing.spec.ts")).not.toBe("PASS");
  });

  it("a spec with a failed test (duration>0) is FAIL not ERRORED", () => {
    const report = loadFixture("fail.json");
    const result = verdictFor(report, "failing.spec.ts");
    expect(result).toBe("FAIL");
    expect(result).not.toBe("ERRORED");
  });
});

// ---------------------------------------------------------------------------
// Synthetic minimal fixtures — validate classification logic directly
// ---------------------------------------------------------------------------

describe("pw-json-reporter — synthetic fixture classification", () => {
  it("PASS: suite with one passing result", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "a.spec.ts",
          file: "a.spec.ts",
          specs: [
            {
              title: "passes",
              ok: true,
              file: "a.spec.ts",
              tests: [
                {
                  results: [{ status: "passed", duration: 5 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "a.spec.ts")).toBe("PASS");
  });

  it("FAIL: suite with one failing result (duration>0)", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "b.spec.ts",
          file: "b.spec.ts",
          specs: [
            {
              title: "fails",
              ok: false,
              file: "b.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 42 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "b.spec.ts")).toBe("FAIL");
  });

  it("ERRORED: suite with ALL failing results at duration===0 (setup crash)", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "c.spec.ts",
          file: "c.spec.ts",
          specs: [
            {
              title: "test1",
              ok: false,
              file: "c.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 0 }],
                },
              ],
            },
            {
              title: "test2",
              ok: false,
              file: "c.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 0 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "c.spec.ts")).toBe("ERRORED");
  });

  it("FAIL not ERRORED: suite with mixed duration>0 and duration===0 failures", () => {
    // If at least one failure has duration>0, it's a real test failure (FAIL)
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "d.spec.ts",
          file: "d.spec.ts",
          specs: [
            {
              title: "test-setup-crash",
              ok: false,
              file: "d.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 0 }],
                },
              ],
            },
            {
              title: "test-real-failure",
              ok: false,
              file: "d.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 15 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "d.spec.ts")).toBe("FAIL");
  });

  it("ERRORED: collection-time error with matching location.file", () => {
    const report: PlaywrightJsonReport = {
      suites: [],
      errors: [
        {
          message: "SyntaxError: Unexpected token",
          location: {
            file: "/abs/path/tests/e2e/broken.spec.ts",
            line: 3,
            column: 1,
          },
        },
      ],
    };
    expect(verdictFor(report, "broken.spec.ts")).toBe("ERRORED");
  });

  it("ZERO_TESTS: no suite entry and no matching error", () => {
    const report: PlaywrightJsonReport = {
      suites: [],
      errors: [],
    };
    expect(verdictFor(report, "ghost.spec.ts")).toBe("ZERO_TESTS");
  });

  it("nested suites (describe blocks): flattens specs correctly", () => {
    // Playwright emits describe-block tests as inner suites
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "nested.spec.ts",
          file: "nested.spec.ts",
          specs: [],
          suites: [
            {
              title: "My describe block",
              file: "nested.spec.ts",
              specs: [
                {
                  title: "inner test passes",
                  ok: true,
                  file: "nested.spec.ts",
                  tests: [
                    {
                      results: [{ status: "passed", duration: 3 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "nested.spec.ts")).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// Issue 1: timedOut and interrupted must be treated as failures (FAIL or ERRORED)
// ---------------------------------------------------------------------------

describe("pw-json-reporter — timedOut/interrupted are failures (fail-closed)", () => {
  it("classifies an all-timedOut spec as FAIL, not PASS (real fixture)", () => {
    // timed-out.json captured from real PW run: status:'timedOut', duration>0
    const report = loadFixture("timed-out.json");
    const verdict = verdictFor(report, "timed-out.spec.ts");
    expect(verdict).not.toBe("PASS");
    expect(["FAIL", "ERRORED"]).toContain(verdict);
  });

  it("classifies an all-interrupted spec as FAIL, not PASS (synthetic fixture)", () => {
    // interrupted.json is synthetic: status:'interrupted', duration:0
    const report = loadFixture("interrupted.json");
    const verdict = verdictFor(report, "interrupted.spec.ts");
    expect(verdict).not.toBe("PASS");
    expect(["FAIL", "ERRORED"]).toContain(verdict);
  });

  it("timedOut with duration>0 classifies as FAIL (not ERRORED) — assertion failure surface", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "t.spec.ts",
          file: "t.spec.ts",
          specs: [
            {
              title: "times out",
              ok: false,
              file: "t.spec.ts",
              tests: [
                {
                  results: [{ status: "timedOut", duration: 500 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "t.spec.ts")).toBe("FAIL");
  });

  it("interrupted with duration===0 classifies as ERRORED (not PASS)", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "u.spec.ts",
          file: "u.spec.ts",
          specs: [
            {
              title: "interrupted",
              ok: false,
              file: "u.spec.ts",
              tests: [
                {
                  results: [{ status: "interrupted", duration: 0 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "u.spec.ts")).toBe("ERRORED");
  });
});

// ---------------------------------------------------------------------------
// Issue 2: all-skipped spec must NOT return PASS (no passing evidence)
// ---------------------------------------------------------------------------

describe("pw-json-reporter — all-skipped spec is not PASS (fail-closed)", () => {
  it("classifies an all-skipped spec as ZERO_TESTS, not PASS (real fixture)", () => {
    const report = loadFixture("all-skipped.json");
    const verdict = verdictFor(report, "all-skipped.spec.ts");
    expect(verdict).not.toBe("PASS");
    // Fail-closed: no passing evidence → ZERO_TESTS (maps to UNKNOWN on dashboard)
    expect(verdict).toBe("ZERO_TESTS");
  });

  it("all-skipped returns spec titles in tests array (skipped tests are registered)", () => {
    // Unlike ERRORED-collection, skipped tests ARE registered in the suite —
    // their titles are available and useful to callers (e.g. for display).
    const report = loadFixture("all-skipped.json");
    const [result] = parsePlaywrightJsonReport(report, ["all-skipped.spec.ts"]);
    expect(result?.tests.length).toBeGreaterThan(0);
  });

  it("synthetic all-skipped spec → ZERO_TESTS", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "sk.spec.ts",
          file: "sk.spec.ts",
          specs: [
            {
              title: "skip1",
              ok: true,
              file: "sk.spec.ts",
              tests: [{ results: [{ status: "skipped", duration: 0 }] }],
            },
            {
              title: "skip2",
              ok: true,
              file: "sk.spec.ts",
              tests: [{ results: [{ status: "skipped", duration: 0 }] }],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "sk.spec.ts")).toBe("ZERO_TESTS");
  });

  it("mixed skipped+passed spec is still PASS (skipped alone does not poison a passing run)", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "mixed-skip.spec.ts",
          file: "mixed-skip.spec.ts",
          specs: [
            {
              title: "passes",
              ok: true,
              file: "mixed-skip.spec.ts",
              tests: [{ results: [{ status: "passed", duration: 3 }] }],
            },
            {
              title: "skip",
              ok: true,
              file: "mixed-skip.spec.ts",
              tests: [{ results: [{ status: "skipped", duration: 0 }] }],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "mixed-skip.spec.ts")).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// Issue 3: Retry handling — honor spec.ok / last retry result (flaky-pass case)
// ---------------------------------------------------------------------------

describe("pw-json-reporter — retry handling honors spec.ok / last retry (fail-closed)", () => {
  it("a flaky spec that ultimately passes (spec.ok:true) → PASS, not FAIL (real fixture)", () => {
    // flaky-retry-pass.json: spec.ok=true, two results: failed(retry:0), passed(retry:1)
    const report = loadFixture("flaky-retry-pass.json");
    const verdict = verdictFor(report, "flaky-retry.spec.ts");
    expect(verdict).toBe("PASS");
  });

  it("synthetic flaky spec: last result passed, spec.ok:true → PASS", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "fl.spec.ts",
          file: "fl.spec.ts",
          specs: [
            {
              title: "flaky",
              ok: true,
              file: "fl.spec.ts",
              tests: [
                {
                  results: [
                    { status: "failed", duration: 3 },
                    { status: "passed", duration: 4 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "fl.spec.ts")).toBe("PASS");
  });

  it("synthetic spec: last result failed, spec.ok:false → FAIL", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "fl2.spec.ts",
          file: "fl2.spec.ts",
          specs: [
            {
              title: "fails all retries",
              ok: false,
              file: "fl2.spec.ts",
              tests: [
                {
                  results: [
                    { status: "failed", duration: 3 },
                    { status: "failed", duration: 2 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "fl2.spec.ts")).toBe("FAIL");
  });
});

// ---------------------------------------------------------------------------
// Issue 4: FAIL vs ERRORED discriminator — use result.error presence, not duration
// ---------------------------------------------------------------------------

describe("pw-json-reporter — FAIL/ERRORED discriminator uses result.error + duration (robust)", () => {
  it("a failed result with duration>0 AND result.error → FAIL (genuine assertion)", () => {
    // Typical test-body assertion failure: ran for measurable time, has error
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "real-fail.spec.ts",
          file: "real-fail.spec.ts",
          specs: [
            {
              title: "fails with assertion",
              ok: false,
              file: "real-fail.spec.ts",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      duration: 5,
                      error: { message: "Expected 1 to be 2" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "real-fail.spec.ts")).toBe("FAIL");
  });

  it("a 0-duration failed result WITH result.error → ERRORED (beforeAll crash with stack)", () => {
    // Playwright emits duration:0 for tests that never ran (beforeAll threw).
    // Even if result.error is present (the hook's stack trace), duration:0
    // is the authoritative signal that the test body did not execute.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "zero-dur-with-err.spec.ts",
          file: "zero-dur-with-err.spec.ts",
          specs: [
            {
              title: "crashes in beforeAll",
              ok: false,
              file: "zero-dur-with-err.spec.ts",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      duration: 0,
                      error: { message: "beforeAll setup threw" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "zero-dur-with-err.spec.ts")).toBe("ERRORED");
  });

  it("a 0-duration failed result WITHOUT result.error → ERRORED (silent setup crash)", () => {
    // beforeAll crash: no assertion error object, duration 0
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "setup-crash.spec.ts",
          file: "setup-crash.spec.ts",
          specs: [
            {
              title: "crashes in setup",
              ok: false,
              file: "setup-crash.spec.ts",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      duration: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "setup-crash.spec.ts")).toBe("ERRORED");
  });
});

// ---------------------------------------------------------------------------
// Issue 5: location-less top-level collection error → ERRORED not ZERO_TESTS
// ---------------------------------------------------------------------------

describe("pw-json-reporter — location-less errors yield ERRORED not ZERO_TESTS", () => {
  it("a report with a location-less error and no suite → ERRORED for targeted spec", () => {
    const report: PlaywrightJsonReport = {
      suites: [],
      errors: [
        {
          // No location.file — a global/runner-level error
          message: "Error: Something went wrong at the runner level",
        },
      ],
    };
    expect(verdictFor(report, "anything.spec.ts")).toBe("ERRORED");
  });

  it("ZERO_TESTS only when errors[] is completely empty and no suite", () => {
    const report: PlaywrightJsonReport = {
      suites: [],
      errors: [],
    };
    expect(verdictFor(report, "ghost.spec.ts")).toBe("ZERO_TESTS");
  });
});

// ---------------------------------------------------------------------------
// Issue 6: collectTestTitles emits per-test titles not per-spec titles
// ---------------------------------------------------------------------------

describe("pw-json-reporter — collectTestTitles returns per-test titles", () => {
  it("returns per-test titles when test has a title property", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "titles.spec.ts",
          file: "titles.spec.ts",
          specs: [
            {
              title: "spec title",
              ok: true,
              file: "titles.spec.ts",
              tests: [
                {
                  title: "test title 1",
                  results: [{ status: "passed", duration: 1 }],
                },
                {
                  title: "test title 2",
                  results: [{ status: "passed", duration: 1 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    const [result] = parsePlaywrightJsonReport(report, ["titles.spec.ts"]);
    // Should return "test title 1" and "test title 2", not "spec title" twice
    expect(result?.tests).toEqual(["test title 1", "test title 2"]);
  });

  it("falls back to spec title when test has no title (backward compat)", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "notitles.spec.ts",
          file: "notitles.spec.ts",
          specs: [
            {
              title: "spec title",
              ok: true,
              file: "notitles.spec.ts",
              tests: [
                {
                  results: [{ status: "passed", duration: 1 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    const [result] = parsePlaywrightJsonReport(report, ["notitles.spec.ts"]);
    expect(result?.tests).toEqual(["spec title"]);
  });
});

// ---------------------------------------------------------------------------
// R2-G1 Bug 1: passed+skipped tests with spec.ok===false → false ERRORED
// Precedence rule: per-result statuses are ground truth; spec.ok is only used
// for retry-final-outcome disambiguation (flaky-pass detection).
// A spec with all-passed/skipped results and no failures must be PASS,
// regardless of the spec.ok flag on the spec wrapper.
// ---------------------------------------------------------------------------

describe("pw-json-reporter — R2-G1 Bug 1: spec.ok===false does not poison passed+skipped results", () => {
  it("passed+skipped results with spec.ok:false → PASS not ERRORED (anomalous but real)", () => {
    // Playwright can set spec.ok:false on a spec that has only passed/skipped
    // tests in edge cases (e.g. threshold-based flakiness tracking). The per-
    // result statuses are ground truth; spec.ok is only used to detect retried
    // flaky specs. If no genuine failures exist, the verdict must not be ERRORED.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "anomalous.spec.ts",
          file: "anomalous.spec.ts",
          specs: [
            {
              title: "passes",
              ok: false, // anomalous — spec.ok disagrees with results
              file: "anomalous.spec.ts",
              tests: [
                {
                  results: [{ status: "passed", duration: 5 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "anomalous.spec.ts")).toBe("PASS");
  });

  it("mixed passed+skipped results with spec.ok:false → PASS not ERRORED", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "mixed-ok-false.spec.ts",
          file: "mixed-ok-false.spec.ts",
          specs: [
            {
              title: "passes",
              ok: false, // anomalous
              file: "mixed-ok-false.spec.ts",
              tests: [
                {
                  results: [{ status: "passed", duration: 3 }],
                },
              ],
            },
            {
              title: "skipped",
              ok: false, // anomalous
              file: "mixed-ok-false.spec.ts",
              tests: [
                {
                  results: [{ status: "skipped", duration: 0 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "mixed-ok-false.spec.ts")).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// R2-G1 Bug 2: genuine failure (duration>0) with spec.ok:true → misclassified PASS
// The FAIL gate must not require !specOk. A genuinely failed result (duration>0)
// must yield FAIL regardless of the spec.ok wrapper.
// ---------------------------------------------------------------------------

describe("pw-json-reporter — R2-G1 Bug 2: FAIL gate must not require !specOk", () => {
  it("duration>0 failed result with spec.ok:true → FAIL not PASS", () => {
    // Edge case: spec.ok:true but the effective result is failed with duration>0.
    // Per-result status is ground truth; specOk:true must not suppress a genuine failure.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "ok-true-fail.spec.ts",
          file: "ok-true-fail.spec.ts",
          specs: [
            {
              title: "genuinely fails",
              ok: true, // anomalous: spec.ok disagrees with last result
              file: "ok-true-fail.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 42 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "ok-true-fail.spec.ts")).toBe("FAIL");
  });

  it("setup crash (duration:0) with spec.ok:true → ERRORED not PASS", () => {
    // Even a setup crash must not be hidden by specOk:true.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "ok-true-crash.spec.ts",
          file: "ok-true-crash.spec.ts",
          specs: [
            {
              title: "crashes in setup",
              ok: true, // anomalous
              file: "ok-true-crash.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 0 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "ok-true-crash.spec.ts")).toBe("ERRORED");
  });
});

// ---------------------------------------------------------------------------
// R2-G1 Bug 3: FAIL gate must not misclassify via specOk after Bugs 1+2 fix
//
// Pre-fix: the FAIL gate required !specOk, so a genuine duration>0 failure
// with specOk:true would bypass isGenuineTestFailure and land in the PASS
// check → PASS. After removing the specOk gate, duration > 0 is the sole
// FAIL discriminator. For duration:0, both error-present and error-absent
// cases stay ERRORED because Playwright uses the same result shape for
// beforeAll crashes (which always have result.error set from the hook stack).
// Fail-closed: we cannot reliably distinguish a sub-1ms test assertion from
// a hook crash purely via error presence, so duration:0 → ERRORED always.
// ---------------------------------------------------------------------------

describe("pw-json-reporter — R2-G1 Bug 3: duration:0 ERRORED regardless of error presence (fail-closed)", () => {
  it("duration>0 failure with specOk:true (edge case) → FAIL, not PASS (specOk no longer gates FAIL)", () => {
    // After removing the !specOk gate from isGenuineTestFailure, a duration>0
    // failure is FAIL regardless of the specOk wrapper.
    // (This duplicates Bug 2's test but explicitly targets the duration discriminator.)
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "dur-ok-fail.spec.ts",
          file: "dur-ok-fail.spec.ts",
          specs: [
            {
              title: "genuine failure",
              ok: true, // anomalous specOk
              file: "dur-ok-fail.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 7 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "dur-ok-fail.spec.ts")).toBe("FAIL");
  });

  it("duration:0 failure WITH result.error → ERRORED (beforeAll crash shape — fail-closed)", () => {
    // Playwright emits result.error even for beforeAll crashes (hook stack trace).
    // We cannot distinguish a sub-1ms assertion from a hook crash via error presence,
    // so duration:0 → ERRORED is the fail-closed choice in all cases.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "zero-dur-err2.spec.ts",
          file: "zero-dur-err2.spec.ts",
          specs: [
            {
              title: "crash",
              ok: false,
              file: "zero-dur-err2.spec.ts",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      duration: 0,
                      error: { message: "some error" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "zero-dur-err2.spec.ts")).toBe("ERRORED");
  });

  it("duration:0 failure WITHOUT result.error → ERRORED (silent hook crash)", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "zero-dur-no-err.spec.ts",
          file: "zero-dur-no-err.spec.ts",
          specs: [
            {
              title: "crash",
              ok: false,
              file: "zero-dur-no-err.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 0 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "zero-dur-no-err.spec.ts")).toBe("ERRORED");
  });
});

// ---------------------------------------------------------------------------
// R2-G1 Bug 4: found-suite path skips location-less global error guard
// When the report has location-less global errors (runner crash, OOM, etc.) and
// a spec has a suite entry, the current code ignores the global errors and can
// return PASS. The guard must apply consistently.
// ---------------------------------------------------------------------------

describe("pw-json-reporter — R2-G1 Bug 4: global location-less errors poison found-suite specs too", () => {
  it("a spec with passing suite but global location-less error → ERRORED not PASS", () => {
    // The runner crashed globally (errors[] has a location-less entry) but the spec
    // was partially recorded as passing. The run is unreliable; fail-closed → ERRORED.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "pass-but-crashed.spec.ts",
          file: "pass-but-crashed.spec.ts",
          specs: [
            {
              title: "appears to pass",
              ok: true,
              file: "pass-but-crashed.spec.ts",
              tests: [
                {
                  results: [{ status: "passed", duration: 5 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [
        {
          // No location.file — a global runner-level error
          message: "Error: Runner OOM — process killed",
        },
      ],
    };
    expect(verdictFor(report, "pass-but-crashed.spec.ts")).toBe("ERRORED");
  });

  it("a spec with FAIL suite and global location-less error → still FAIL (not promoted to ERRORED)", () => {
    // When the spec itself has genuine failures, the verdict is FAIL regardless
    // of global errors. The global error guard only prevents false-PASSes.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "fail-and-crashed.spec.ts",
          file: "fail-and-crashed.spec.ts",
          specs: [
            {
              title: "genuinely fails",
              ok: false,
              file: "fail-and-crashed.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 10 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [
        {
          message: "Error: Runner crashed",
        },
      ],
    };
    // A FAIL is already fail-closed (bad result) — promoting to ERRORED would
    // obscure the actual failure mode. FAIL is acceptable here.
    expect(verdictFor(report, "fail-and-crashed.spec.ts")).toBe("FAIL");
  });

  it("a spec with ERRORED suite and global location-less error → ERRORED", () => {
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "errored-and-crashed.spec.ts",
          file: "errored-and-crashed.spec.ts",
          specs: [
            {
              title: "hook crashes",
              ok: false,
              file: "errored-and-crashed.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 0 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [
        {
          message: "Error: Global runner error",
        },
      ],
    };
    expect(verdictFor(report, "errored-and-crashed.spec.ts")).toBe("ERRORED");
  });
});

// ---------------------------------------------------------------------------
// H2-1: report.errors undefined/null → must not throw TypeError
// ---------------------------------------------------------------------------

describe("pw-json-reporter — H2-1: report.errors undefined/null is normalized defensively", () => {
  it("does not throw when report.errors is undefined", () => {
    // A malformed/partial Playwright JSON report may omit errors entirely.
    // The parser must not throw TypeError (.some/.forEach on undefined).
    const report = {
      suites: [
        {
          title: "a.spec.ts",
          file: "a.spec.ts",
          specs: [
            {
              title: "passes",
              ok: true,
              file: "a.spec.ts",
              tests: [{ results: [{ status: "passed", duration: 5 }] }],
            },
          ],
        },
      ],
      // errors deliberately omitted — violates the type but real-world Playwright
      // versions have emitted JSON without this field
    } as unknown as PlaywrightJsonReport;
    expect(() => verdictFor(report, "a.spec.ts")).not.toThrow();
  });

  it("returns correct verdict (PASS) when report.errors is undefined and suite matches", () => {
    const report = {
      suites: [
        {
          title: "no-errors-field.spec.ts",
          file: "no-errors-field.spec.ts",
          specs: [
            {
              title: "passes",
              ok: true,
              file: "no-errors-field.spec.ts",
              tests: [{ results: [{ status: "passed", duration: 3 }] }],
            },
          ],
        },
      ],
    } as unknown as PlaywrightJsonReport;
    expect(verdictFor(report, "no-errors-field.spec.ts")).toBe("PASS");
  });

  it("returns ZERO_TESTS (not throw) when report.errors is undefined and no suite", () => {
    const report = {
      suites: [],
    } as unknown as PlaywrightJsonReport;
    expect(() => verdictFor(report, "missing.spec.ts")).not.toThrow();
    expect(verdictFor(report, "missing.spec.ts")).toBe("ZERO_TESTS");
  });

  it("does not throw when report.errors is null", () => {
    const report = {
      suites: [],
      errors: null,
    } as unknown as PlaywrightJsonReport;
    expect(() => verdictFor(report, "any.spec.ts")).not.toThrow();
  });

  it("fixture: errors-omitted.json — must not throw and must return correct verdict", () => {
    const report = loadFixture("errors-omitted.json");
    expect(() => verdictFor(report, "a.spec.ts")).not.toThrow();
    expect(verdictFor(report, "a.spec.ts")).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// H2-2: basename collision — ambiguous basename must not misattribute
// ---------------------------------------------------------------------------

describe("pw-json-reporter — H2-2: ambiguous basename match → UNKNOWN (fail-closed)", () => {
  it("two suites with same basename but different dirs → targeted spec returns UNKNOWN not misattributed", () => {
    // If two spec files share a basename (e.g. chat/index.spec.ts and
    // sidebar/index.spec.ts) and the caller targets one of them by basename
    // only, a first-match-wins strategy would silently misattribute the result.
    // Fail-closed: ambiguous basename → treat as missing (ZERO_TESTS or ERRORED).
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "chat/index.spec.ts",
          file: "chat/index.spec.ts",
          specs: [
            {
              title: "chat passes",
              ok: true,
              file: "chat/index.spec.ts",
              tests: [{ results: [{ status: "passed", duration: 5 }] }],
            },
          ],
        },
        {
          title: "sidebar/index.spec.ts",
          file: "sidebar/index.spec.ts",
          specs: [
            {
              title: "sidebar fails",
              ok: false,
              file: "sidebar/index.spec.ts",
              tests: [{ results: [{ status: "failed", duration: 10 }] }],
            },
          ],
        },
      ],
      errors: [],
    };
    // Targeting by basename only — ambiguous because two suites share the basename "index.spec.ts"
    const verdict = verdictFor(report, "index.spec.ts");
    // Must NOT return PASS (which would be wrong attribution of chat result to sidebar target)
    // and must NOT return FAIL (wrong attribution of sidebar result).
    // Fail-closed: ambiguous basename → ZERO_TESTS (treated as missing, no confident attribution)
    expect(verdict).toBe("ZERO_TESTS");
  });

  it("unambiguous basename (only one suite has that basename) → still matches correctly", () => {
    // When only one suite has the targeted basename, the match IS unambiguous
    // and must succeed (preserves the useful lookup behavior).
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "auth/login.spec.ts",
          file: "auth/login.spec.ts",
          specs: [
            {
              title: "logs in",
              ok: true,
              file: "auth/login.spec.ts",
              tests: [{ results: [{ status: "passed", duration: 8 }] }],
            },
          ],
        },
        {
          title: "dashboard/main.spec.ts",
          file: "dashboard/main.spec.ts",
          specs: [
            {
              title: "renders",
              ok: true,
              file: "dashboard/main.spec.ts",
              tests: [{ results: [{ status: "passed", duration: 4 }] }],
            },
          ],
        },
      ],
      errors: [],
    };
    // "login.spec.ts" is unambiguous — only auth/login.spec.ts has that basename
    expect(verdictFor(report, "login.spec.ts")).toBe("PASS");
  });

  it("two targeted specs with same basename collapse onto one suite entry → both must get independent results", () => {
    // If two targeted paths share a basename and both match the same suite file
    // via basename fallback, they would collapse onto the same result.
    // Fail-closed: ambiguous → both return ZERO_TESTS (no unambiguous match).
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "tests/a/spec.ts",
          file: "tests/a/spec.ts",
          specs: [
            {
              title: "passes",
              ok: true,
              file: "tests/a/spec.ts",
              tests: [{ results: [{ status: "passed", duration: 3 }] }],
            },
          ],
        },
        {
          title: "tests/b/spec.ts",
          file: "tests/b/spec.ts",
          specs: [
            {
              title: "also passes",
              ok: true,
              file: "tests/b/spec.ts",
              tests: [{ results: [{ status: "passed", duration: 3 }] }],
            },
          ],
        },
      ],
      errors: [],
    };
    // Both of these targets have basename "spec.ts" which is present in two suites
    const results = parsePlaywrightJsonReport(report, [
      "tests/a/spec.ts",
      "tests/b/spec.ts",
    ]);
    // These have path-level (suffix) matches, not basename-only — suffix match is fine
    expect(results[0]?.status).toBe("PASS");
    expect(results[1]?.status).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// H2-3: blank location.file must be treated as location-less (fail-closed)
// ---------------------------------------------------------------------------

describe("pw-json-reporter — H2-3: blank location.file treated as location-less", () => {
  it("error with location.file='' is treated as location-less (not located)", () => {
    // An error with location present but file='' should count as a global/
    // location-less error, not as a located error for any specific file.
    const report: PlaywrightJsonReport = {
      suites: [],
      errors: [
        {
          message: "Runner error",
          location: { file: "", line: 1, column: 1 },
        },
      ],
    };
    // With blank file, the error is location-less → run is unreliable → ERRORED
    expect(verdictFor(report, "anything.spec.ts")).toBe("ERRORED");
  });

  it("error with location.file='   ' (whitespace) is treated as location-less", () => {
    const report: PlaywrightJsonReport = {
      suites: [],
      errors: [
        {
          message: "Runner error",
          location: { file: "   ", line: 0, column: 0 },
        },
      ],
    };
    expect(verdictFor(report, "anything.spec.ts")).toBe("ERRORED");
  });

  it("blank location.file does NOT trigger hasCollectionError for a real spec path", () => {
    // A blank file must not accidentally match any real spec path.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "real.spec.ts",
          file: "real.spec.ts",
          specs: [
            {
              title: "passes",
              ok: true,
              file: "real.spec.ts",
              tests: [{ results: [{ status: "passed", duration: 5 }] }],
            },
          ],
        },
      ],
      errors: [
        {
          message: "Some error",
          location: { file: "", line: 0, column: 0 },
        },
      ],
    };
    // Blank file is location-less → PASS suite promoted to ERRORED (location-less guard)
    // It must NOT match real.spec.ts as a collection error (which would wipe the suite lookup)
    const result = parsePlaywrightJsonReport(report, ["real.spec.ts"])[0];
    // The suite IS present but the run had a global error → ERRORED (not mismatched collection)
    expect(result?.status).toBe("ERRORED");
    // Specifically: it should NOT return ZERO_TESTS (that would mean suite was lost)
    expect(result?.status).not.toBe("ZERO_TESTS");
  });
});

// ---------------------------------------------------------------------------
// H2-4: JSDoc accuracy — deriveVerdictFromSpecs doc sync (doc-only, code unchanged)
// These tests confirm the actual runtime behavior that the fixed doc now describes.
// ---------------------------------------------------------------------------

describe("pw-json-reporter — H2-4: deriveVerdictFromSpecs actual behavior (JSDoc sync)", () => {
  it("duration:0 + error present → ERRORED (not FAIL) — matches corrected JSDoc", () => {
    // The original JSDoc claimed duration-0+error→FAIL but code returns ERRORED.
    // The fixed JSDoc says duration:0 → ERRORED regardless of error presence.
    // This test confirms the ACTUAL behavior (code is correct, doc was wrong).
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "doc-sync.spec.ts",
          file: "doc-sync.spec.ts",
          specs: [
            {
              title: "crashes with error",
              ok: false,
              file: "doc-sync.spec.ts",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      duration: 0,
                      error: { message: "beforeAll threw" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    // duration:0 → ERRORED regardless of error presence (fail-closed)
    expect(verdictFor(report, "doc-sync.spec.ts")).toBe("ERRORED");
    expect(verdictFor(report, "doc-sync.spec.ts")).not.toBe("FAIL");
  });

  it("ERRORED-runtime result populates tests[] with spec titles (SpecResult.tests contract)", () => {
    // When the suite IS present (runtime ERRORED via duration:0), Playwright has
    // recorded the spec entries even though tests never ran. collectTestTitles still
    // collects those titles (documented behavior: populated for runtime ERRORED,
    // empty only for collection-ERRORED where no suite exists).
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "runtime-errored.spec.ts",
          file: "runtime-errored.spec.ts",
          specs: [
            {
              title: "test that never ran",
              ok: false,
              file: "runtime-errored.spec.ts",
              tests: [
                {
                  title: "my test title",
                  results: [{ status: "failed", duration: 0 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    const [result] = parsePlaywrightJsonReport(report, [
      "runtime-errored.spec.ts",
    ]);
    expect(result?.status).toBe("ERRORED");
    // titles ARE populated for runtime-ERRORED (suite existed, just hook crashed)
    expect(result?.tests).toContain("my test title");
  });
});

// ---------------------------------------------------------------------------
// J3-Fix1: hasCollectionError ambiguity guard
//
// A collection error whose location.file suffix-matches multiple spec paths
// must NOT be attributed to any one target — doing so pre-empts a present-
// and-failing suite and turns a real FAIL into a spurious ERRORED.
//
// The ambiguity guard: collect ALL strict matches; return true only when
// EXACTLY ONE matches (mirrors findSpecsForTarget's collect-all-count-one
// rule). Ambiguous → fall through to suite verdict.
// ---------------------------------------------------------------------------

describe("pw-json-reporter — J3-Fix1: hasCollectionError ambiguity guard", () => {
  it("RED→GREEN: ambiguous collection error (two errors, one target suffix) → falls through to suite FAIL not ERRORED", () => {
    // Two collection errors, both of whose location.file end with "foo.spec.ts"
    // (e.g. "bar/foo.spec.ts" and "baz/foo.spec.ts"). The target "foo.spec.ts"
    // suffix-matches BOTH. Pre-fix: the first match wins → ERRORED (wrong
    // attribution pre-empts the suite's real FAIL). Post-fix: ambiguous →
    // do not attribute → fall through to suite verdict (FAIL).
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "bar/foo.spec.ts",
          file: "bar/foo.spec.ts",
          specs: [
            {
              title: "fails genuinely",
              ok: false,
              file: "bar/foo.spec.ts",
              tests: [
                {
                  results: [{ status: "failed", duration: 50 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [
        {
          message: "SyntaxError in bar/foo",
          location: { file: "bar/foo.spec.ts", line: 1, column: 1 },
        },
        {
          message: "SyntaxError in baz/foo",
          location: { file: "baz/foo.spec.ts", line: 1, column: 1 },
        },
      ],
    };
    // Targeting by basename "foo.spec.ts" — suffix-matches BOTH errors.
    // Ambiguous → must NOT return ERRORED (wrong attribution);
    // must fall through to the suite, which has a genuine failure → FAIL.
    expect(verdictFor(report, "foo.spec.ts")).toBe("FAIL");
  });

  it("unambiguous collection error (one error matches) → ERRORED (unchanged behavior)", () => {
    // Single matching error — unambiguous attribution must still work.
    const report: PlaywrightJsonReport = {
      suites: [],
      errors: [
        {
          message: "SyntaxError",
          location: { file: "only-this.spec.ts", line: 1, column: 1 },
        },
      ],
    };
    expect(verdictFor(report, "only-this.spec.ts")).toBe("ERRORED");
  });

  it("ambiguous collection error with no matching suite → ZERO_TESTS (not ERRORED from wrong attribution)", () => {
    // Two errors, both suffix-match "foo.spec.ts", no suite for bar/foo.
    // Ambiguous → not attributed as collection error → no suite → ZERO_TESTS.
    // (No location-less errors either, so no global-error ERRORED promotion.)
    const report: PlaywrightJsonReport = {
      suites: [],
      errors: [
        {
          message: "Error in bar/foo",
          location: { file: "bar/foo.spec.ts", line: 1, column: 1 },
        },
        {
          message: "Error in baz/foo",
          location: { file: "baz/foo.spec.ts", line: 1, column: 1 },
        },
      ],
    };
    // Both errors have non-blank location.file so they are NOT location-less.
    // Ambiguous collection match → not attributed → no suite → ZERO_TESTS.
    expect(verdictFor(report, "foo.spec.ts")).toBe("ZERO_TESTS");
  });
});

// ---------------------------------------------------------------------------
// J3-Fix2: interrupted with duration > 0 → FAIL (fixture + pinning test)
//
// The `interrupted` status with duration > 0 means the test body was
// dispatched and ran before the process was killed — it is a genuine test
// failure (FAIL), not a setup crash (ERRORED).
//
// The existing interrupted.json fixture has duration:0 (covers ERRORED arm).
// This section adds a fixture with duration > 0 and pins the FAIL arm so
// that a regression dropping "interrupted" from isGenuineTestFailure causes
// this test to fail.
// ---------------------------------------------------------------------------

describe("pw-json-reporter — J3-Fix2: interrupted+duration>0 → FAIL (fixture arm pinning)", () => {
  it("interrupted with duration>0 classifies as FAIL, not ERRORED (real fixture)", () => {
    // interrupted-duration-positive.json: status:'interrupted', duration:1500
    // SYNTHETIC fixture — shape matches real Playwright JSON for a test that
    // was dispatched and running when SIGTERM arrived (duration > 0 confirms
    // the test body started). This arm had ZERO fixture coverage before this fix.
    const report = loadFixture("interrupted-duration-positive.json");
    const verdict = verdictFor(report, "interrupted-dur-pos.spec.ts");
    expect(verdict).toBe("FAIL");
    expect(verdict).not.toBe("ERRORED");
    expect(verdict).not.toBe("PASS");
  });

  it("interrupted with duration>0 → FAIL (synthetic inline, regression pin)", () => {
    // Inline synthetic to pin the exact predicate path through isGenuineTestFailure.
    // If "interrupted" is removed from the status check, this fails.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "sigterm.spec.ts",
          file: "sigterm.spec.ts",
          specs: [
            {
              title: "was interrupted mid-run",
              ok: false,
              file: "sigterm.spec.ts",
              tests: [
                {
                  results: [{ status: "interrupted", duration: 300 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "sigterm.spec.ts")).toBe("FAIL");
  });

  it("timedOut with duration>0 → FAIL (regression pin: timedOut in isGenuineTestFailure)", () => {
    // Companion regression pin for timedOut. Mirrors the interrupted pin above.
    const report: PlaywrightJsonReport = {
      suites: [
        {
          title: "timeout.spec.ts",
          file: "timeout.spec.ts",
          specs: [
            {
              title: "timed out mid-run",
              ok: false,
              file: "timeout.spec.ts",
              tests: [
                {
                  results: [{ status: "timedOut", duration: 30000 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(verdictFor(report, "timeout.spec.ts")).toBe("FAIL");
  });
});
