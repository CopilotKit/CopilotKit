/**
 * Golden-master identity test for the unified cell-model engine.
 *
 * The golden master of the CURRENT (unified) `buildCellModel` over the full
 * fixture matrix (`cell-model.equivalence-fixtures.ts`), stored as TWO
 * partitions whose union this test asserts byte-identity against:
 *
 *   - `cell-model.equivalence-baseline.non-starter.json` — 57 entries, the
 *     agent-axis and null-feature (liveness) fixtures. This partition is
 *     FROZEN across the starter-ladder change: the `combine()` generalization
 *     onto `LadderAxis` must not move a single byte of it, and
 *     `git diff --exit-code` on this file is the mechanical equivalence gate.
 *   - `cell-model.equivalence-baseline.starter.json` — 8 entries, the starter
 *     axis. These MOVE with the ladder change (row rekey, real `DEPTH_OF`,
 *     ceiling 0 → 3) and are re-frozen in their own reviewed commit.
 *
 * The partition exists so "the equivalence baseline did not move" is a claim
 * that can actually be gated. Against a single file the starter entries would
 * guarantee a non-empty diff and the cheapest repair would be to regenerate
 * everything after the change — which destroys the guard.
 *
 * For every fixture, `serializeModel(buildCellModel(...))` equals its baseline
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
const readPartition = (file: string): Record<string, Record<string, unknown>> =>
  JSON.parse(readFileSync(join(HERE, file), "utf8"));
const NON_STARTER = readPartition(
  "cell-model.equivalence-baseline.non-starter.json",
);
const STARTER = readPartition("cell-model.equivalence-baseline.starter.json");
const BASELINE: Record<string, Record<string, unknown>> = {
  ...NON_STARTER,
  ...STARTER,
};

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

  it("the two partitions are disjoint and split on the starter axis", () => {
    const ns = Object.keys(NON_STARTER);
    const st = Object.keys(STARTER);
    // Disjoint: a name in both would make the union silently prefer one.
    expect(ns.filter((n) => n in STARTER)).toEqual([]);
    // The split predicate is the starter axis, not a hand-maintained list —
    // so a new starter fixture cannot land in the frozen partition.
    expect(ns.filter((n) => n.includes("starter"))).toEqual([]);
    expect(st.filter((n) => !n.includes("starter"))).toEqual([]);
  });
});
