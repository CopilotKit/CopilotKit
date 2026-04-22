import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  e2eSmokeDriver,
  createE2eSmokeDriver,
  type PlaywrightRunner,
} from "./e2e-smoke.js";
import { logger } from "../../logger.js";

// Driver-level tests for the e2e-smoke Playwright driver. Deep behavioural
// coverage for log truncation lives in `../e2e-smoke.test.ts` (byte-budget
// matrix); this file verifies the driver adapter layer — schema shape,
// reporter-JSON parsing, the driver-level timeout kill-switch, and the
// malformed-reporter error branch — without double-counting tests.

const FIXTURES = path.resolve(__dirname, "../../../test/fixtures/e2e-smoke");

function baseCtx() {
  return {
    now: () => new Date("2026-04-21T00:00:00Z"),
    logger,
    env: {},
  };
}

describe("e2eSmokeDriver", () => {
  it("exposes kind === 'e2e_smoke'", () => {
    expect(e2eSmokeDriver.kind).toBe("e2e_smoke");
  });

  it("inputSchema accepts { key } alone", () => {
    const parsed = e2eSmokeDriver.inputSchema.safeParse({
      key: "e2e_smoke:l1-3",
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema accepts { key, suite: 'l1-3' }", () => {
    const parsed = e2eSmokeDriver.inputSchema.safeParse({
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema accepts { key, suite: 'l4' }", () => {
    const parsed = e2eSmokeDriver.inputSchema.safeParse({
      key: "e2e_smoke:l4",
      suite: "l4",
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema rejects unknown suite value", () => {
    const parsed = e2eSmokeDriver.inputSchema.safeParse({
      key: "e2e_smoke:l1-3",
      suite: "l99",
    });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects empty key", () => {
    const parsed = e2eSmokeDriver.inputSchema.safeParse({ key: "" });
    expect(parsed.success).toBe(false);
  });

  it("reports green when reporter JSON says all pass (happy path)", async () => {
    const passFixture = path.join(FIXTURES, "playwright-pass.json");
    const runner: PlaywrightRunner = async () => ({ reporterJsonPath: passFixture });
    const driver = createE2eSmokeDriver({ runner });
    const r = await driver.run(baseCtx(), {
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(r.state).toBe("green");
    expect(r.key).toBe("e2e_smoke:l1-3");
    const signal = r.signal as { suite: string; failureSummary: string };
    expect(signal.suite).toBe("l1-3");
    expect(signal.failureSummary).toBe("");
  });

  it("reports red with failureSummary when reporter JSON says fail", async () => {
    const failFixture = path.join(FIXTURES, "playwright-fail.json");
    const runner: PlaywrightRunner = async () => ({ reporterJsonPath: failFixture });
    const driver = createE2eSmokeDriver({ runner });
    const r = await driver.run(baseCtx(), {
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(r.state).toBe("red");
    const signal = r.signal as { suite: string; failureSummary: string };
    expect(signal.failureSummary.length).toBeGreaterThan(0);
    // Must include the failing test's error message, not just the title.
    expect(signal.failureSummary).toMatch(/expected.*received|assertion|Error/i);
  });

  it("enforces driver-level timeout: Playwright hangs → red with 'timeout' errorDesc", async () => {
    let cleaned = false;
    const runner: PlaywrightRunner = (_opts, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          cleaned = true;
          reject(new Error("aborted"));
        });
        // Never resolve on its own — driver must kill via AbortSignal.
      });
    const driver = createE2eSmokeDriver({ runner, timeoutMs: 25 });
    const r = await driver.run(baseCtx(), {
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(r.state).toBe("red");
    const signal = r.signal as { failureSummary: string; errorDesc?: string };
    const combined = (signal.errorDesc ?? "") + " " + (signal.failureSummary ?? "");
    expect(combined.toLowerCase()).toMatch(/timeout/);
    expect(cleaned).toBe(true);
  });

  it("reports red with parse errorDesc when reporter JSON is malformed", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-smoke-malformed-"));
    const malformed = path.join(tmp, "reporter.json");
    await fs.writeFile(malformed, "{not valid json", "utf-8");
    const runner: PlaywrightRunner = async () => ({ reporterJsonPath: malformed });
    const driver = createE2eSmokeDriver({ runner });
    const r = await driver.run(baseCtx(), {
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(r.state).toBe("red");
    const signal = r.signal as { failureSummary: string; errorDesc?: string };
    const combined = (signal.errorDesc ?? "") + " " + (signal.failureSummary ?? "");
    expect(combined.toLowerCase()).toMatch(/parse|invalid|json|malformed/);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("reports red when reporter JSON file is missing", async () => {
    const runner: PlaywrightRunner = async () => ({
      reporterJsonPath: "/nonexistent/path/reporter.json",
    });
    const driver = createE2eSmokeDriver({ runner });
    const r = await driver.run(baseCtx(), {
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(r.state).toBe("red");
  });

  it("reports red when the runner throws (Playwright crash)", async () => {
    const runner: PlaywrightRunner = async () => {
      throw new Error("chromium-missing-headless-shell");
    };
    const driver = createE2eSmokeDriver({ runner });
    const r = await driver.run(baseCtx(), {
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(r.state).toBe("red");
    const signal = r.signal as { errorDesc?: string; failureSummary: string };
    const combined = (signal.errorDesc ?? "") + " " + signal.failureSummary;
    expect(combined).toContain("chromium-missing-headless-shell");
  });

  it("defaults suite to 'l1-3' when input omits suite", async () => {
    const passFixture = path.join(FIXTURES, "playwright-pass.json");
    const runner: PlaywrightRunner = async () => ({ reporterJsonPath: passFixture });
    const driver = createE2eSmokeDriver({ runner });
    const r = await driver.run(baseCtx(), { key: "e2e_smoke:l1-3" });
    expect(r.state).toBe("green");
    const signal = r.signal as { suite: string };
    expect(signal.suite).toBe("l1-3");
  });

  it("module-level e2eSmokeDriver is a configured driver (kind + inputSchema present)", () => {
    expect(typeof e2eSmokeDriver.run).toBe("function");
    expect(e2eSmokeDriver.kind).toBe("e2e_smoke");
  });

  it("default driver returns runner-error when invoked without a custom runner", async () => {
    // Exercises the `defaultPlaywrightRunner` stub path: until Phase 4.1
    // wires the real chromium harness, the default throws — which the
    // driver catches and surfaces as red + runner-error. Confirms the
    // module-level default-export is runnable (doesn't throw out of
    // the driver's own try/catch).
    const r = await e2eSmokeDriver.run(baseCtx(), {
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(r.state).toBe("red");
    const signal = r.signal as { errorDesc?: string; failureSummary: string };
    expect(signal.errorDesc).toBe("runner-error");
    expect(signal.failureSummary).toMatch(/playwright runner not yet wired/);
  });

  it("reports red with generic fallback when unexpected > 0 but no per-spec error present", async () => {
    // Hand-crafted reporter where stats.unexpected is set but no spec
    // carries an `error` field — exercises the "no error detail" fallback
    // summary so a malformed-but-parseable reporter still alerts.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-smoke-nodetail-"));
    const p = path.join(tmp, "reporter.json");
    await fs.writeFile(
      p,
      JSON.stringify({
        stats: { unexpected: 2, expected: 3 },
        suites: [{ title: "root", specs: [] }],
      }),
      "utf-8",
    );
    const runner: PlaywrightRunner = async () => ({ reporterJsonPath: p });
    const driver = createE2eSmokeDriver({ runner });
    const r = await driver.run(baseCtx(), {
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(r.state).toBe("red");
    const signal = r.signal as { failureSummary: string };
    expect(signal.failureSummary).toContain("2 test(s) failed");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("walks nested suite trees to find a failure (exercises suites.suites recursion)", async () => {
    // Playwright reporters can nest `suites` under `suites` for
    // describe-block grouping; the collector must recurse to find a
    // failing spec buried beneath an empty top-level suite.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-smoke-nested-"));
    const p = path.join(tmp, "reporter.json");
    await fs.writeFile(
      p,
      JSON.stringify({
        stats: { unexpected: 1, expected: 1 },
        suites: [
          {
            title: "outer",
            specs: [],
            suites: [
              {
                title: "inner",
                specs: [
                  {
                    title: "deep failure",
                    ok: false,
                    tests: [
                      {
                        results: [
                          {
                            status: "failed",
                            error: { message: "NESTED_FAILURE_MARKER" },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      "utf-8",
    );
    const runner: PlaywrightRunner = async () => ({ reporterJsonPath: p });
    const driver = createE2eSmokeDriver({ runner });
    const r = await driver.run(baseCtx(), {
      key: "e2e_smoke:l1-3",
      suite: "l1-3",
    });
    expect(r.state).toBe("red");
    const signal = r.signal as { failureSummary: string };
    expect(signal.failureSummary).toContain("NESTED_FAILURE_MARKER");
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
