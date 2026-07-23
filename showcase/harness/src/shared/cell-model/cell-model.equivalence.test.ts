/**
 * Golden-master identity test for the unified cell-model engine.
 *
 * `cell-model.equivalence-baseline.json` is the frozen golden master of the
 * CURRENT (unified) `buildCellModel` over the full fixture matrix
 * (`cell-model.equivalence-fixtures.ts`). This test asserts pure byte-identity:
 * for every fixture, `serializeModel(buildCellModel(...))` equals its baseline
 * entry. Any drift in the engine's output surfaces here.
 *
 * To re-freeze the baseline after an intentional engine change, regenerate the
 * JSON from the current engine over the same fixtures and review the diff.
 *
 * History: during the ladder redesign this baseline was first frozen from the
 * PRE-change engine and gated against the new pipeline via a swap-time
 * diff-allowlist (`cell-model.intentional-changes.ts` +
 * `cell-model.equivalence-diff.test.ts`). Post-swap those swap-time artifacts
 * were retired and the baseline re-frozen from the unified engine, leaving this
 * clean identity check as the permanent guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildCellModel } from "./cell-model.js";
import {
  FIXTURES,
  NOW,
  serializeModel,
} from "./cell-model.equivalence-fixtures.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE: Record<string, Record<string, unknown>> = JSON.parse(
  readFileSync(join(HERE, "cell-model.equivalence-baseline.json"), "utf8"),
);

describe("buildCellModel — golden-master identity", () => {
  for (const f of FIXTURES) {
    it(`matches baseline for fixture: ${f.name}`, () => {
      const actual = serializeModel(buildCellModel(f.live, f.input, NOW));
      expect(actual).toEqual(BASELINE[f.name]);
    });
  }

  it("has exactly one baseline entry per fixture (no stale/missing)", () => {
    const fixtureNames = new Set(FIXTURES.map((f) => f.name));
    const baselineNames = new Set(Object.keys(BASELINE));
    expect([...baselineNames].sort()).toEqual([...fixtureNames].sort());
  });
});
