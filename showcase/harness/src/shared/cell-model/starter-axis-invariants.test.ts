/**
 * The two invariants that pin `STARTER_AXIS.ladderKinds` as a STATIC module
 * constant — never truncated per cell.
 *
 * Why this file exists: "the scan set is the axis's rung set, truncated at the
 * cell's structural ceiling" is a reading a module constant cannot support, and
 * it is DEFECT-REINTRODUCING. Executed against the pre-change engine, a
 * `ladderKinds = ["S1"]` truncation renders:
 *
 *   trio S1 green / S2 FAIL_FRESH
 *     {"chipColor":"green","achievedDepth":1,"ceilingDepth":3,"isRegression":true}
 *
 * — a green chip at `D1` over a fresh-red S2, the originating defect verbatim
 * — while an all-red assertion still PASSES. So the all-red case is necessary
 * and not sufficient, and the truncation needs its own pin.
 *
 * `STARTER_CEILING` is declared in `cell-model.combine.ts` as an INDEPENDENT
 * literal, NOT as `STARTER_AXIS.ladderKinds.length`. Derived, clause (a) below
 * would be a tautology and clause (b) would become one too — the test added
 * specifically to close this hazard would be decorative, which is worse than no
 * test because it reads as coverage.
 *
 * MUTATIONS THAT RED THIS FILE:
 *   (a) truncate `STARTER_AXIS.ladderKinds` to `["S1"]` (or extend it to
 *       `["S1","S2","S3","S4"]`) without moving `STARTER_CEILING`;
 *   (b) pass any ceiling other than `STARTER_CEILING` at `buildCellModel`'s
 *       starter call site — e.g. reinstating the pinned `ceilingDepth: 0`.
 */
import { describe, it, expect } from "vitest";
import {
  STARTER_AXIS,
  STARTER_CEILING,
  AGENT_AXIS,
  LIVENESS_AXIS,
} from "./cell-model.combine.js";
import { buildCellModel } from "./cell-model.js";
import type { CellModelInput } from "./cell-model.js";
import { keyFor, mergeRowsToMap, STARTER_ROW_LEVELS } from "./live-status.js";
import type { State, StatusRow } from "./live-status.js";

const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const FRESH = new Date(NOW - 60_000).toISOString();
const COL = "langgraph-python";

const starterRow = (level: string, state: State): StatusRow => ({
  id: `id-${level}`,
  key: keyFor("starter", COL, level),
  dimension: "starter",
  state,
  signal: state === "red" ? { errorClass: "assertion-failed" } : null,
  observed_at: FRESH,
  transitioned_at: FRESH,
  fail_count: state === "red" ? 9 : 0,
  first_failure_at: state === "red" ? FRESH : null,
});

const STARTER_CELL: CellModelInput = {
  slug: COL,
  featureId: "starter",
  isSupported: true,
  isWired: true,
  probeAxis: "starter",
};

describe("STARTER_AXIS invariants", () => {
  it("(a) ladderKinds.length === STARTER_CEILING", () => {
    expect(STARTER_AXIS.ladderKinds.length).toBe(STARTER_CEILING);
  });

  it("(b) every starter cell is folded at ceilingDepth === ladderKinds.length", () => {
    // Deliberately a cell with rows on only ONE rung: the ceiling comes from
    // the AXIS, never from the rows found, so a starved cell still reports 3.
    const sparse = buildCellModel(
      mergeRowsToMap([starterRow("shell", "green")]),
      STARTER_CELL,
      NOW,
    );
    expect(sparse.ceilingDepth).toBe(STARTER_AXIS.ladderKinds.length);

    const full = buildCellModel(
      mergeRowsToMap(STARTER_ROW_LEVELS.map((l) => starterRow(l, "green"))),
      STARTER_CELL,
      NOW,
    );
    expect(full.ceilingDepth).toBe(STARTER_AXIS.ladderKinds.length);

    // And an EMPTY cell: no rows at all still declares the full ceiling, so the
    // denominator can never silently shrink to match what was observed.
    const empty = buildCellModel(mergeRowsToMap([]), STARTER_CELL, NOW);
    expect(empty.ceilingDepth).toBe(STARTER_AXIS.ladderKinds.length);
  });

  it("the row-key levels and the axis rungs describe ONE ladder", () => {
    expect(STARTER_ROW_LEVELS.length).toBe(STARTER_AXIS.ladderKinds.length);
  });

  it("the starter axis has no gate rungs and no soft-parity top", () => {
    // Both are load-bearing. A gate rung would force `achieved = 0` on a
    // fresh-red S1/S2 and destroy the D0-vs-D1 distinction (container down
    // vs runtime unmounted). A soft top would render every healthy starter
    // amber, because the soft-top branch returns amber when its rung is absent.
    expect(STARTER_AXIS.gateKinds).toEqual([]);
    expect(STARTER_AXIS.softTop).toBeNull();
    expect(STARTER_AXIS.ceilingIsComplete).toBe(true);
  });

  it("the three axes stay distinguishable on the inputs that separate them", () => {
    // `ceilingIsComplete` and `softTop` are INDEPENDENT inputs: a single
    // boolean could not express the starter axis, because the previously-coded
    // "complete" branch reached into the D6 rung and returned amber when it was
    // absent. These three rows are the proof the split was necessary.
    expect(AGENT_AXIS.ceilingIsComplete).toBe(false);
    expect(AGENT_AXIS.softTop).toEqual({ kind: "D6", atCeiling: 6 });
    expect(LIVENESS_AXIS.ceilingIsComplete).toBe(true);
    expect(LIVENESS_AXIS.softTop).toBeNull();
    expect(STARTER_AXIS.ceilingIsComplete).toBe(true);
    expect(STARTER_AXIS.softTop).toBeNull();
  });
});
