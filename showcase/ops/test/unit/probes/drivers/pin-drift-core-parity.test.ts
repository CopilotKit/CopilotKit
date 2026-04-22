import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { computePinDrift as opsCompute } from "../../../../src/probes/drivers/pin-drift-core.js";
import { computePinDrift as scriptsCompute } from "../../../../../scripts/validate-pins-core.js";

// Cross-module parity test. The ops driver has its own local copy of the
// drift comparison logic (required because tsc's rootDir: src forbids
// cross-package imports in the ops build), and `showcase/scripts/
// validate-pins-core.ts` is the module the CLI + CI consume. Either
// implementation drifting from the other is a correctness bug — this
// test is the enforcement mechanism.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "pin-drift",
);

function shellHash(lines: string[]): string {
  if (lines.length === 0) return "";
  const d = Array.from(new Set(lines)).sort();
  return createHash("sha256").update(d.join("\n") + "\n").digest("hex");
}

function makeBaseline(count: number, hash: string): string {
  return JSON.stringify({
    validatePinsFailCount: count,
    validatePinsFailHash: hash,
  });
}

describe("pin-drift-core parity (ops driver ↔ scripts CLI)", () => {
  const cases: Array<{ name: string; baseline: string; state: unknown }> = [
    {
      name: "stable",
      baseline: makeBaseline(2, shellHash(["[FAIL] a", "[FAIL] b"])),
      state: { failed: ["[FAIL] a", "[FAIL] b"] },
    },
    {
      name: "regressed count-up",
      baseline: makeBaseline(1, shellHash(["[FAIL] a"])),
      state: { failed: ["[FAIL] a", "[FAIL] b"] },
    },
    {
      name: "improved count-down",
      baseline: makeBaseline(3, shellHash(["[FAIL] a", "[FAIL] b", "[FAIL] c"])),
      state: { failed: ["[FAIL] a"] },
    },
    {
      name: "no_baseline",
      baseline: "",
      state: { failed: ["[FAIL] x"] },
    },
    {
      name: "set-drift equal-count different-hash",
      baseline: makeBaseline(2, shellHash(["[FAIL] a", "[FAIL] b"])),
      state: { failed: ["[FAIL] a", "[FAIL] c"] },
    },
    {
      name: "raw failLines filter",
      baseline: "",
      state: {
        failLines: [
          "[WARN] noise",
          "[FAIL] a",
          "[FAIL] b",
          "unrelated",
        ],
      },
    },
  ];

  for (const c of cases) {
    it(`both modules agree on: ${c.name}`, () => {
      const opsR = opsCompute({
        failBaselineJson: c.baseline,
        currentWorkingState: c.state,
      });
      const scriptsR = scriptsCompute({
        failBaselineJson: c.baseline,
        currentWorkingState: c.state,
      });
      expect(opsR).toEqual(scriptsR);
    });
  }

  it("both modules agree on the committed fail-baseline.json fixture", () => {
    const baselineText = fs.readFileSync(
      path.join(FIXTURES, "fail-baseline.json"),
      "utf8",
    );
    const stderrText = fs.readFileSync(
      path.join(FIXTURES, "cli-baseline-stderr.txt"),
      "utf8",
    );
    const input = {
      failBaselineJson: baselineText,
      currentWorkingState: { failLines: stderrText.split("\n") },
    };
    const opsR = opsCompute(input);
    const scriptsR = scriptsCompute(input);
    expect(opsR).toEqual(scriptsR);
    expect(opsR.status).toBe("stable");
  });
});
