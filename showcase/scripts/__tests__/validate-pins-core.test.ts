import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import {
  computePinDrift,
  PinDriftBaselineError,
} from "../validate-pins-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.resolve(__dirname, "fixtures", "pin-drift");

// Helper: build a baseline JSON document matching the on-disk shape of
// `showcase/scripts/fail-baseline.json`. Keep the `_comment` field in —
// the schema ignores unknown top-level keys so this matches production.
function makeBaseline(count: number, hash: string): string {
  return JSON.stringify({
    _comment: "test baseline",
    validatePinsFailCount: count,
    validatePinsFailHash: hash,
    baselineDemoCount: 9,
  });
}

// Helper: compute the hash the same way the CI shell does —
// `sort -u | shasum -a 256` — so each test can produce its own expected
// hash without copy-pasting hex strings. If this differs from the
// implementation, every test flips red.
function shellHash(lines: string[]): string {
  if (lines.length === 0) return "";
  const deduped = Array.from(new Set(lines)).sort();
  return createHash("sha256")
    .update(deduped.join("\n") + "\n")
    .digest("hex");
}

describe("computePinDrift", () => {
  it("stable: identical FAIL sets → status 'stable', delta 0", () => {
    const failed = ["[FAIL] a", "[FAIL] b", "[FAIL] c"];
    const baseline = makeBaseline(failed.length, shellHash(failed));
    const r = computePinDrift({
      failBaselineJson: baseline,
      currentWorkingState: { failed },
    });
    expect(r.status).toBe("stable");
    expect(r.delta).toBe(0);
    expect(r.actualCount).toBe(3);
    expect(r.baselineCount).toBe(3);
  });

  it("regressed: additional FAIL → positive delta", () => {
    const prior = ["[FAIL] a", "[FAIL] b"];
    const now = ["[FAIL] a", "[FAIL] b", "[FAIL] c"];
    const baseline = makeBaseline(prior.length, shellHash(prior));
    const r = computePinDrift({
      failBaselineJson: baseline,
      currentWorkingState: { failed: now },
    });
    expect(r.status).toBe("regressed");
    expect(r.delta).toBe(1);
    expect(r.actualCount).toBe(3);
  });

  it("improved: fewer FAILs → negative delta", () => {
    const prior = ["[FAIL] a", "[FAIL] b", "[FAIL] c"];
    const now = ["[FAIL] a"];
    const baseline = makeBaseline(prior.length, shellHash(prior));
    const r = computePinDrift({
      failBaselineJson: baseline,
      currentWorkingState: { failed: now },
    });
    expect(r.status).toBe("improved");
    expect(r.delta).toBe(-2);
  });

  it("no_baseline: empty baseline file → status 'no_baseline'", () => {
    const r = computePinDrift({
      failBaselineJson: "",
      currentWorkingState: { failed: ["[FAIL] a"] },
    });
    expect(r.status).toBe("no_baseline");
    expect(r.actualCount).toBe(1);
    expect(r.baselineCount).toBe(0);
    expect(r.delta).toBe(0);
  });

  it("no_baseline: whitespace-only baseline → status 'no_baseline'", () => {
    // Whitespace-only means the file exists but hasn't been seeded yet —
    // we don't want an accidental fs.readFileSync of a stub to crash
    // before ratchet can run.
    const r = computePinDrift({
      failBaselineJson: "   \n\t\n",
      currentWorkingState: { failed: [] },
    });
    expect(r.status).toBe("no_baseline");
  });

  it("regressed on equal-count/different-set: remove 1, add 1 → 'regressed'", () => {
    // Hash ratchet invariant: if the count matches but the set rotated,
    // that's NOT stable — the CI shell treats it as a regression so a
    // silent "heal one, break one" slip cannot sneak past weekly drift.
    const prior = ["[FAIL] a", "[FAIL] b"];
    const now = ["[FAIL] a", "[FAIL] c"];
    const baseline = makeBaseline(prior.length, shellHash(prior));
    const r = computePinDrift({
      failBaselineJson: baseline,
      currentWorkingState: { failed: now },
    });
    expect(r.status).toBe("regressed");
    expect(r.delta).toBe(0); // count equal...
    expect(r.hash).not.toBe(shellHash(prior)); // ...but hash differs
  });

  it("malformed baseline JSON throws PinDriftBaselineError", () => {
    expect(() =>
      computePinDrift({
        failBaselineJson: "{not json",
        currentWorkingState: { failed: [] },
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("baseline with wrong type for validatePinsFailCount throws", () => {
    expect(() =>
      computePinDrift({
        failBaselineJson: JSON.stringify({
          validatePinsFailCount: "not a number",
          validatePinsFailHash: "a".repeat(64),
        }),
        currentWorkingState: { failed: [] },
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("baseline with malformed hash throws", () => {
    expect(() =>
      computePinDrift({
        failBaselineJson: JSON.stringify({
          validatePinsFailCount: 0,
          validatePinsFailHash: "ZZZZ",
        }),
        currentWorkingState: { failed: [] },
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("baseline that isn't an object throws", () => {
    expect(() =>
      computePinDrift({
        failBaselineJson: JSON.stringify([1, 2, 3]),
        currentWorkingState: { failed: [] },
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("currentWorkingState must carry failLines or failed", () => {
    expect(() =>
      computePinDrift({
        failBaselineJson: makeBaseline(0, shellHash([])),
        currentWorkingState: { bogus: true },
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("currentWorkingState: null throws", () => {
    expect(() =>
      computePinDrift({
        failBaselineJson: makeBaseline(0, shellHash([])),
        currentWorkingState: null,
      }),
    ).toThrow(PinDriftBaselineError);
  });

  it("accepts raw `failLines` stderr shape (filters non-FAIL)", () => {
    // Raw stderr from the CLI carries [WARN] and [FAIL] lines. Only
    // [FAIL] lines participate in the ratchet — mirrors
    // `grep -E '^\[FAIL\]'` in the CI shell.
    const stderr = [
      "[WARN] pkg: skipped x",
      "[FAIL] a: foo",
      "[FAIL] b: bar",
      "[WARN] pkg: skipped y",
    ];
    const r = computePinDrift({
      failBaselineJson: "",
      currentWorkingState: { failLines: stderr },
    });
    expect(r.actualCount).toBe(2);
    expect(r.failed).toEqual(["[FAIL] a: foo", "[FAIL] b: bar"]);
  });

  it("dedupes repeated FAIL lines (matches sort -u)", () => {
    const r = computePinDrift({
      failBaselineJson: "",
      currentWorkingState: {
        failed: ["[FAIL] a", "[FAIL] a", "[FAIL] b", "[FAIL] b", "[FAIL] c"],
      },
    });
    expect(r.actualCount).toBe(3);
    expect(r.failed).toEqual(["[FAIL] a", "[FAIL] b", "[FAIL] c"]);
  });

  it("returns empty hash when no FAILs", () => {
    const r = computePinDrift({
      failBaselineJson: "",
      currentWorkingState: { failed: [] },
    });
    expect(r.hash).toBe("");
    expect(r.failed).toEqual([]);
  });

  describe("legacy-parity cross-check against committed fail-baseline.json", () => {
    // This is the Slot D cross-check: drive the committed baseline +
    // captured CLI stderr snapshot through `computePinDrift` and assert
    // it matches the same count/hash the CI shell ratchet would compute.
    // If either side drifts (CI shell changes, or our core math changes)
    // this test flips red — that is the whole point.
    it("matches committed baseline count + hash from captured CLI output", () => {
      const baselineJson = fs.readFileSync(
        path.join(FIXTURES, "fail-baseline.json"),
        "utf8",
      );
      const stderr = fs
        .readFileSync(path.join(FIXTURES, "cli-baseline-stderr.txt"), "utf8")
        .split("\n");
      const r = computePinDrift({
        failBaselineJson: baselineJson,
        currentWorkingState: { failLines: stderr },
      });
      const parsed = JSON.parse(baselineJson) as {
        validatePinsFailCount: number;
        validatePinsFailHash: string;
      };
      expect(r.actualCount).toBe(parsed.validatePinsFailCount);
      expect(r.hash).toBe(parsed.validatePinsFailHash);
      expect(r.status).toBe("stable");
      expect(r.delta).toBe(0);
    });

    it("Summary stdout line reports FAIL=actualCount (format contract)", () => {
      // The CI shell extracts `FAIL=<int>` from the Summary line of the
      // CLI's stdout. If the CLI output format drifts, the shell extractor
      // breaks — this test pins the format we depend on.
      const stdout = fs.readFileSync(
        path.join(FIXTURES, "cli-baseline-stdout.txt"),
        "utf8",
      );
      const match = stdout.match(/FAIL=(\d+)/);
      expect(match).not.toBeNull();
      const baselineJson = fs.readFileSync(
        path.join(FIXTURES, "fail-baseline.json"),
        "utf8",
      );
      const parsed = JSON.parse(baselineJson) as {
        validatePinsFailCount: number;
      };
      expect(Number(match![1])).toBe(parsed.validatePinsFailCount);
    });
  });
});
