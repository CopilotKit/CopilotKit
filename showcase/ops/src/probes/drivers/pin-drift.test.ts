import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import {
  createPinDriftDriver,
  pinDriftDriver,
  type ValidatePinsRunner,
} from "./pin-drift.js";
import { logger } from "../../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "test",
  "fixtures",
  "pin-drift",
);

// Build a throwaway repo-root with a `showcase/scripts/fail-baseline.json`
// so the driver's readFileSync hits real bytes but test suites stay
// self-contained (no dependence on the repo state of the checkout the
// tests are running in).
function makeRepoRoot(baselineText: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pin-drift-driver-"));
  const dir = path.join(root, "showcase", "scripts");
  fs.mkdirSync(dir, { recursive: true });
  if (baselineText !== null) {
    fs.writeFileSync(path.join(dir, "fail-baseline.json"), baselineText);
  }
  return root;
}

function shellHash(lines: string[]): string {
  if (lines.length === 0) return "";
  const d = Array.from(new Set(lines)).sort();
  return createHash("sha256")
    .update(d.join("\n") + "\n")
    .digest("hex");
}

function mockRunner(opts: {
  stderr?: string;
  stdout?: string;
  exitCode?: number | null;
  throwErr?: Error;
}): ValidatePinsRunner {
  return {
    async run() {
      if (opts.throwErr) throw opts.throwErr;
      return {
        stdout: opts.stdout ?? "",
        stderr: opts.stderr ?? "",
        exitCode: opts.exitCode ?? 0,
      };
    },
  };
}

const BASE_CTX = {
  now: () => new Date("2026-04-21T00:00:00Z"),
  logger,
};

describe("pinDriftDriver", () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    for (const r of tmpRoots.splice(0)) {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it("exposes kind === 'pin_drift'", () => {
    expect(pinDriftDriver.kind).toBe("pin_drift");
  });

  it("inputSchema accepts { key }", () => {
    const parsed = pinDriftDriver.inputSchema.safeParse({
      key: "pin_drift:overall",
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema rejects missing key", () => {
    expect(pinDriftDriver.inputSchema.safeParse({}).success).toBe(false);
  });

  it("inputSchema rejects empty key", () => {
    expect(pinDriftDriver.inputSchema.safeParse({ key: "" }).success).toBe(
      false,
    );
  });

  it("state:'error' when fail-baseline.json is missing", async () => {
    // No baseline file at all — ENOENT from readFileSync. Driver must
    // surface this as a keyed error, never silently fall through.
    const root = makeRepoRoot(null);
    tmpRoots.push(root);
    const driver = createPinDriftDriver(mockRunner({}));
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    expect(r.state).toBe("error");
    expect(r.key).toBe("pin_drift:overall");
  });

  it("state:'error' when baseline JSON is malformed", async () => {
    const root = makeRepoRoot("{not json");
    tmpRoots.push(root);
    const driver = createPinDriftDriver(mockRunner({}));
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    expect(r.state).toBe("error");
  });

  it("state:'green' stable when FAIL set matches baseline", async () => {
    const failed = ["[FAIL] a", "[FAIL] b"];
    const root = makeRepoRoot(
      JSON.stringify({
        validatePinsFailCount: 2,
        validatePinsFailHash: shellHash(failed),
      }),
    );
    tmpRoots.push(root);
    const driver = createPinDriftDriver(
      mockRunner({ stderr: failed.join("\n"), exitCode: 1 }),
    );
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    expect(r.state).toBe("green");
    expect((r.signal as { setStatus: string }).setStatus).toBe("stable");
    expect((r.signal as { delta: number }).delta).toBe(0);
    expect((r.signal as { hash: string }).hash).toBe(shellHash(failed));
  });

  it("state:'green' regressed when count goes up", async () => {
    const prior = ["[FAIL] a"];
    const now = ["[FAIL] a", "[FAIL] b"];
    const root = makeRepoRoot(
      JSON.stringify({
        validatePinsFailCount: prior.length,
        validatePinsFailHash: shellHash(prior),
      }),
    );
    tmpRoots.push(root);
    const driver = createPinDriftDriver(
      mockRunner({ stderr: now.join("\n"), exitCode: 1 }),
    );
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    const sig = r.signal as { setStatus: string; delta: number };
    expect(sig.setStatus).toBe("regressed");
    expect(sig.delta).toBe(1);
  });

  it("state:'green' improved when count goes down", async () => {
    const prior = ["[FAIL] a", "[FAIL] b", "[FAIL] c"];
    const now = ["[FAIL] a"];
    const root = makeRepoRoot(
      JSON.stringify({
        validatePinsFailCount: prior.length,
        validatePinsFailHash: shellHash(prior),
      }),
    );
    tmpRoots.push(root);
    const driver = createPinDriftDriver(
      mockRunner({ stderr: now.join("\n"), exitCode: 1 }),
    );
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    const sig = r.signal as { setStatus: string; delta: number };
    expect(sig.setStatus).toBe("improved");
    expect(sig.delta).toBe(-2);
  });

  it("state:'green' no_baseline on empty baseline", async () => {
    const root = makeRepoRoot("");
    tmpRoots.push(root);
    const driver = createPinDriftDriver(
      mockRunner({ stderr: "[FAIL] a\n", exitCode: 1 }),
    );
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    expect(r.state).toBe("green");
    const sig = r.signal as { setStatus: string; noBaseline: boolean };
    expect(sig.setStatus).toBe("no_baseline");
    expect(sig.noBaseline).toBe(true);
  });

  it("hash-drift ratchet: equal count, different set → regressed", async () => {
    // The probe alone would call this stable (count matches); the driver
    // MUST override with the core module's hash-aware verdict.
    const prior = ["[FAIL] a", "[FAIL] b"];
    const now = ["[FAIL] a", "[FAIL] c"];
    const root = makeRepoRoot(
      JSON.stringify({
        validatePinsFailCount: prior.length,
        validatePinsFailHash: shellHash(prior),
      }),
    );
    tmpRoots.push(root);
    const driver = createPinDriftDriver(
      mockRunner({ stderr: now.join("\n"), exitCode: 1 }),
    );
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    const sig = r.signal as {
      setStatus: string;
      regressed: boolean;
      stable: boolean;
      delta: number;
    };
    expect(sig.setStatus).toBe("regressed");
    expect(sig.regressed).toBe(true);
    expect(sig.stable).toBe(false);
    expect(sig.delta).toBe(0);
  });

  it("state:'error' when runner throws", async () => {
    const root = makeRepoRoot(
      JSON.stringify({
        validatePinsFailCount: 0,
        validatePinsFailHash: "0".repeat(64),
      }),
    );
    tmpRoots.push(root);
    const driver = createPinDriftDriver(
      mockRunner({ throwErr: new Error("spawn EACCES") }),
    );
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    expect(r.state).toBe("error");
  });

  it("state:'error' when validator exits with unexpected code", async () => {
    const root = makeRepoRoot(
      JSON.stringify({
        validatePinsFailCount: 0,
        validatePinsFailHash: "0".repeat(64),
      }),
    );
    tmpRoots.push(root);
    // Exit 2 = EXIT_INTERNAL per validate-pins.ts taxonomy.
    const driver = createPinDriftDriver(mockRunner({ exitCode: 2 }));
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    expect(r.state).toBe("error");
  });

  it("exit code 0 (clean) treated as legitimate drift signal", async () => {
    const root = makeRepoRoot(
      JSON.stringify({
        validatePinsFailCount: 0,
        validatePinsFailHash: "",
      }),
    );
    tmpRoots.push(root);
    // Hash field type check: core requires 64-hex. Empty baseline → use
    // a valid hash field but count 0; with empty hash set, driver still
    // produces stable because both sides are empty. Use a valid hash
    // format to match the schema.
    fs.writeFileSync(
      path.join(root, "showcase", "scripts", "fail-baseline.json"),
      JSON.stringify({
        validatePinsFailCount: 0,
        validatePinsFailHash: "a".repeat(64),
      }),
    );
    const driver = createPinDriftDriver(mockRunner({ exitCode: 0 }));
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    expect(r.state).toBe("green");
    // Count=0 matches baseline count=0, but hash differs (our "a"*64 vs
    // empty ""). That's a set-drift → regressed. This is the correct
    // conservative verdict for a mis-seeded baseline.
    const sig = r.signal as { setStatus: string };
    expect(sig.setStatus).toBe("regressed");
  });

  it("legacy-parity cross-check: drives committed baseline + captured stderr through driver", async () => {
    // Reuses the Slot D fixtures. The driver should compute the same
    // count + hash the CI shell computes on the production baseline.
    const baselinePath = path.join(FIXTURES, "fail-baseline.json");
    const stderrPath = path.join(FIXTURES, "cli-baseline-stderr.txt");
    const baselineText = fs.readFileSync(baselinePath, "utf8");
    const stderrText = fs.readFileSync(stderrPath, "utf8");
    const root = makeRepoRoot(baselineText);
    tmpRoots.push(root);
    const driver = createPinDriftDriver(
      mockRunner({ stderr: stderrText, exitCode: 1 }),
    );
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    const parsed = JSON.parse(baselineText) as {
      validatePinsFailCount: number;
      validatePinsFailHash: string;
    };
    const sig = r.signal as {
      setStatus: string;
      hash: string;
      delta: number;
    };
    expect(sig.setStatus).toBe("stable");
    expect(sig.hash).toBe(parsed.validatePinsFailHash);
    expect(sig.delta).toBe(0);
  });

  it("respects ctx.env.PIN_DRIFT_REPO_ROOT override", async () => {
    const root = makeRepoRoot(
      JSON.stringify({
        validatePinsFailCount: 0,
        validatePinsFailHash: "a".repeat(64),
      }),
    );
    tmpRoots.push(root);
    let capturedRoot = "";
    const driver = createPinDriftDriver({
      async run(repoRoot) {
        capturedRoot = repoRoot;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: root } },
      { key: "pin_drift:overall" },
    );
    expect(capturedRoot).toBe(root);
  });
});

describe("pinDriftDriver default instance", () => {
  beforeEach(() => {
    // no-op; test confirms default export is wired up.
  });

  it("default export is a ProbeDriver with correct kind", () => {
    expect(pinDriftDriver.kind).toBe("pin_drift");
    expect(typeof pinDriftDriver.run).toBe("function");
  });

  it("falls back to derived repo root when env var empty", async () => {
    // Exercise the resolveRepoRoot default branch: no env var set, so
    // the driver walks up from its own location. The derived root will
    // be the real repo root — the fail-baseline.json there is valid,
    // but we don't want to actually run validate-pins (134 subprocesses),
    // so inject a no-op runner that returns a stable empty-stderr run.
    const driver = createPinDriftDriver({
      async run() {
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    const r = await driver.run(
      { ...BASE_CTX, env: {} },
      { key: "pin_drift:overall" },
    );
    // Either reads the real repo baseline (status stable/regressed/etc.)
    // or fails with error if the walk-up path resolves outside the repo;
    // in both cases we get a well-formed ProbeResult and don't crash.
    expect(["green", "error"]).toContain(r.state);
  });

  it("falls back when env var is whitespace-only", async () => {
    const driver = createPinDriftDriver({
      async run() {
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    const r = await driver.run(
      { ...BASE_CTX, env: { PIN_DRIFT_REPO_ROOT: "   " } },
      { key: "pin_drift:overall" },
    );
    expect(["green", "error"]).toContain(r.state);
  });
});

describe("pin-drift-core (direct unit coverage)", () => {
  // Additional direct unit tests on the local core module to lift
  // driver-dir coverage to ≥95%. The full test matrix lives in
  // `showcase/scripts/__tests__/validate-pins-core.test.ts`; these
  // here cover the branches that the driver tests don't exercise
  // (non-array failLines, null state, etc.).
  it("rejects null currentWorkingState", async () => {
    const { computePinDrift, PinDriftBaselineError } =
      await import("./pin-drift-core.js");
    expect(() =>
      computePinDrift({
        failBaselineJson: "",
        currentWorkingState: null,
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("rejects currentWorkingState without failLines or failed", async () => {
    const { computePinDrift, PinDriftBaselineError } =
      await import("./pin-drift-core.js");
    expect(() =>
      computePinDrift({
        failBaselineJson: "",
        currentWorkingState: { unrelated: "x" },
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("throws on malformed baseline JSON", async () => {
    const { computePinDrift, PinDriftBaselineError } =
      await import("./pin-drift-core.js");
    expect(() =>
      computePinDrift({
        failBaselineJson: "{not json",
        currentWorkingState: { failed: [] },
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("throws on baseline array (wrong top-level type)", async () => {
    const { computePinDrift, PinDriftBaselineError } =
      await import("./pin-drift-core.js");
    expect(() =>
      computePinDrift({
        failBaselineJson: "[1,2]",
        currentWorkingState: { failed: [] },
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("throws on bad validatePinsFailCount type", async () => {
    const { computePinDrift, PinDriftBaselineError } =
      await import("./pin-drift-core.js");
    expect(() =>
      computePinDrift({
        failBaselineJson: JSON.stringify({
          validatePinsFailCount: "x",
          validatePinsFailHash: "a".repeat(64),
        }),
        currentWorkingState: { failed: [] },
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("throws on bad validatePinsFailHash format", async () => {
    const { computePinDrift, PinDriftBaselineError } =
      await import("./pin-drift-core.js");
    expect(() =>
      computePinDrift({
        failBaselineJson: JSON.stringify({
          validatePinsFailCount: 0,
          validatePinsFailHash: "zz",
        }),
        currentWorkingState: { failed: [] },
      }),
    ).toThrow(PinDriftBaselineError);
  });
});
