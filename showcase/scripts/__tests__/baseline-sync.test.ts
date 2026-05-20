/**
 * Sync contract: validate-parity.ts's BASELINE_DEMO_COUNT constant and
 * fail-baseline.json's `baselineDemoCount` field are two declarations of
 * the same number — the per-package e2e-spec-count floor. The workflow
 * .github/workflows/showcase_validate.yml reads the JSON; validate-parity.ts
 * uses the TS constant as its default. A divergence means the validator
 * and the CI gate disagree silently, so we lock them together here.
 *
 * Prior to this test the contract was enforced only by a comment ("keep
 * in sync"), which is trivially violated without any CI signal. R29-7
 * finding #4 / R29-5.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BASELINE_DEMO_COUNT } from "../validate-parity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("baselineDemoCount sync contract", () => {
  it("fail-baseline.json `baselineDemoCount` equals validate-parity.ts BASELINE_DEMO_COUNT", () => {
    const baselinePath = path.resolve(__dirname, "..", "fail-baseline.json");
    const raw = fs.readFileSync(baselinePath, "utf8");
    const parsed = JSON.parse(raw) as { baselineDemoCount?: unknown };
    // Explicit type guard rather than a blind cast — if the field ever
    // disappears or its type flips, we want a clear failure, not
    // `undefined === <n>` silently passing as false.
    expect(typeof parsed.baselineDemoCount).toBe("number");
    expect(Number.isInteger(parsed.baselineDemoCount)).toBe(true);
    expect(parsed.baselineDemoCount).toBe(BASELINE_DEMO_COUNT);
  });
});
