/**
 * The starter ladder's RED-FIRST gate (spec §4.2 Part A) plus the two permanent
 * structural invariants (Part B(2) and B(3)).
 *
 * Every case here was run against its own stated pre-fix baseline and observed
 * to FAIL before the fix. The baselines are NOT all the same engine, so each
 * case names its own:
 *
 *   A1 / A2 / A5  — `origin/main`'s `combine()` (executed; output in each case)
 *   A3            — a deliberately ROW-DRIVEN `collectStarterLadder` (the
 *                   natural implementation; the function does not exist on
 *                   `origin/main`)
 *   A4            — `LIVENESS_AXIS.gateGapBreaks = false` (the axis does not
 *                   exist on `origin/main`); it lives in
 *                   `cell-model.combine.test.ts` + this file's siblings, and is
 *                   run as a mutation rather than as a committed case.
 *
 * THE PRIMARY GATE IS A1, NOT A2. An all-red ladder is NECESSARY AND NOT
 * SUFFICIENT: a `ladderKinds = ["S1"]` truncation satisfies an all-red
 * assertion while rendering GREEN at `D1` over a fresh-red S2 — the
 * originating defect verbatim.
 */
import { describe, it, expect } from "vitest";
import {
  combine,
  AGENT_AXIS,
  STARTER_AXIS,
  STARTER_CEILING,
} from "./cell-model.combine.js";
import type {
  ContributionKind,
  RungContribution,
  RungKind,
} from "./cell-model.contribution.js";
import { buildCellModel } from "./cell-model.js";
import type { CellModelInput, TestStatus } from "./cell-model.js";
import { keyFor, mergeRowsToMap, STARTER_ROW_LEVELS } from "./live-status.js";
import type { State, StatusRow } from "./live-status.js";

const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const FRESH = new Date(NOW - 60_000).toISOString();
const COL = "langgraph-python";

/** Mirrors `classifyRung`'s real `rawStatus` (the RAW folded row colour). */
function rawStatusOf(k: ContributionKind): TestStatus {
  switch (k) {
    case "GREEN_FRESH":
      return "green";
    case "FAIL_FRESH":
    case "INFRA_RED_FRESH":
    case "FIRST_STRIKE_FRESH":
      return "red";
    case "STALE_DEGRADED":
      return "amber";
    default:
      return null;
  }
}
const c = (
  kind: RungKind,
  contribution: ContributionKind,
): RungContribution => ({
  kind,
  contribution,
  rawStatus: rawStatusOf(contribution),
  freshestAgeMs: 0,
});

const starterRow = (
  level: string,
  state: State,
  extra: Partial<StatusRow> = {},
): StatusRow => ({
  id: `id-${level}`,
  key: keyFor("starter", COL, level),
  dimension: "starter",
  state,
  signal: state === "red" ? { errorClass: "assertion-failed" } : null,
  observed_at: FRESH,
  transitioned_at: FRESH,
  fail_count: state === "red" ? 9 : 0,
  first_failure_at: state === "red" ? FRESH : null,
  ...extra,
});

const STARTER_CELL: CellModelInput = {
  slug: COL,
  featureId: "starter",
  isSupported: true,
  isWired: true,
  probeAxis: "starter",
};

// ───────────────────────────────────────────────────────────────────────────
// Part A — RED before anything, at unit level
// ───────────────────────────────────────────────────────────────────────────

describe("Part A — the starter ladder folds red before it folds green", () => {
  // A1 — THE PRIMARY GATE.
  //
  // BASELINE: `origin/main`'s `combine()`. Executed, verbatim:
  //   A1 green-over-red (S1 green / S2 FAIL_FRESH / S3 green, ceil 3) ->
  //     {"chipColor":"green","ceilingDepth":3,"d6Effective":null,
  //      "isRegression":false}
  //   (`achievedDepth` is absent from that JSON because `DEPTH_OF["S1"]` was
  //   `undefined` — the starter kinds did not exist in the depth table at all.)
  //
  // This is the langgraph trio's exact shape on live staging: `GET /` serves
  // 200 from a stale image while `/api/copilotkit/info` 404s, so S1 is green,
  // S2 is a 102-day-old fresh red, and S3's row — whatever it says — must not
  // be credited. It is red under the correct design and GREEN under BOTH
  // `origin/main` AND the `ladderKinds` truncation, which is why the gate is
  // built on it rather than on the all-red case.
  it("A1 green-over-red: S1 green / S2 fresh-red / S3 green ⇒ red at D1", () => {
    const r = combine(
      [c("S1", "GREEN_FRESH"), c("S2", "FAIL_FRESH"), c("S3", "GREEN_FRESH")],
      STARTER_CEILING,
      NOW,
      STARTER_AXIS,
    );
    expect(r.chipColor).toBe("red");
    expect(r.achievedDepth).toBe(1);
    expect(r.ceilingDepth).toBe(3);
    expect(r.isRegression).toBe(true);
  });

  // A1 end-to-end, through the REAL `buildCellModel` over a synthesized
  // `LiveStatusMap` — the same shape, one level up, so a defect in the
  // collector or in `foldLadderCell` cannot hide behind a hand-built
  // contribution list.
  it("A1 end-to-end: the trio's row shape renders one red cell at D1", () => {
    const m = buildCellModel(
      mergeRowsToMap([
        starterRow("shell", "green"),
        starterRow("runtime", "red"),
        starterRow("agentrun", "green"),
      ]),
      STARTER_CELL,
      NOW,
    );
    expect(m.chipColor).toBe("red");
    expect(m.achievedDepth).toBe(1);
    expect(m.ceilingDepth).toBe(3);

    // And the TOOLTIP must not contradict the chip: S3 is above the stop, so it
    // renders `gated`, never green. `combine` does not CLEAR upper rungs, it
    // only declines to credit them — without the gating this prints `S3 ✓`
    // directly beneath `S2 ✗`, the defect relocated into the detail surface.
    const byKind = new Map((m.ladderRungs ?? []).map((r) => [r.kind, r]));
    expect(byKind.get("S1")?.state).toBe("green");
    expect(byKind.get("S2")?.state).toBe("red");
    expect(byKind.get("S3")?.state).toBe("gated");
  });

  // A2 — all-red. NECESSARY, NOT SUFFICIENT; retained because it is the
  // cleanest statement of the baseline inversion.
  //
  // BASELINE: `origin/main`'s `combine()`. Executed, verbatim:
  //   A2 ALL-RED STARTER LADDER ->
  //     {"chipColor":"green","achievedDepth":0,"ceilingDepth":3,
  //      "d6Effective":null,"isRegression":true}
  //   CONTROL agent all-red D3/D4 ->
  //     {"chipColor":"red","achievedDepth":2,"ceilingDepth":4,
  //      "d6Effective":null,"isRegression":true}
  it("A2 all-red: every rung FAIL_FRESH ⇒ red (agent control stays red too)", () => {
    const r = combine(
      [c("S1", "FAIL_FRESH"), c("S2", "FAIL_FRESH"), c("S3", "FAIL_FRESH")],
      STARTER_CEILING,
      NOW,
      STARTER_AXIS,
    );
    expect(r.chipColor).toBe("red");
    expect(r.achievedDepth).toBe(0);

    // The control proves the harness is wired: it was red at the baseline and
    // must stay red here. Without it, "red" could mean "the fold is broken in
    // the other direction".
    const control = combine(
      [
        c("D1", "GREEN_FRESH"),
        c("D2", "GREEN_FRESH"),
        c("D3", "FAIL_FRESH"),
        c("D4", "FAIL_FRESH"),
      ],
      4,
      NOW,
      AGENT_AXIS,
    );
    expect(control.chipColor).toBe("red");
    expect(control.achievedDepth).toBe(2);
  });

  // A3 — the ABSENT gap, at the COLLECTOR.
  //
  // `combine` alone cannot catch this: `scanWorst` `continue`s past a kind that
  // is simply not in the contribution list (correct for an unmapped D5), which
  // is exactly why the guard sits one level up.
  //
  // BASELINE: a deliberately ROW-DRIVEN collector — the natural implementation,
  // which builds its rung list from the rows it found. Executed on that shape:
  //   S1 green, [S2 contribution omitted], S3 green
  //     {"chipColor":"green","achievedDepth":3,"ceilingDepth":3,
  //      "isRegression":false}
  //   S1 green, S2 ABSENT,                 S3 green
  //     {"chipColor":"gray","achievedDepth":1,"ceilingDepth":3,
  //      "isRegression":false}
  //
  // A cell rendering GREEN at `D3` for a starter whose runtime rung never ran
  // is the same green-over-absence class this ladder exists to close.
  it("A3 the ABSENT gap: S2's rows deleted ⇒ explicit ABSENT, and NOT green", () => {
    // S2's rows are absent from the map entirely.
    const live = mergeRowsToMap([
      starterRow("shell", "green"),
      starterRow("agentrun", "green"),
    ]);
    const m = buildCellModel(live, STARTER_CELL, NOW);

    // The collector emitted a contribution for S2 anyway, because it iterates
    // `STARTER_AXIS.ladderKinds` and not the rows it found.
    const s2 = (m.ladderRungs ?? []).find((r) => r.kind === "S2");
    expect(s2).toBeDefined();
    expect(s2?.state).toBe("absent");

    expect(m.chipColor).not.toBe("green");
    expect(m.chipColor).toBe("gray");
    expect(m.achievedDepth).toBe(1);
    expect(m.ceilingDepth).toBe(3);
  });

  // A5 — a GATED rung still colours the chip.
  //
  // BASELINE: the `axis.ladderKinds.slice(0, achieved + 1)` mutation of the NEW
  // `computeChip` — "only scan up to the stopping rung". It is the ONLY
  // surviving mutation of the whole revised gate: it passes the axis
  // invariants, A1-A4, both Part B(2) predicates, Part B(3) and every live
  // observation, while folding THIS shape to amber where
  // `scanWorst(axis.ladderKinds)` gives red. (126 of the 729 exhaustive rung
  // combinations diverge; it survives the live observation only because no
  // column today has a soft-stopped rung above a hard-red one.)
  //
  // It is also the one place the chip and the tooltip deliberately say
  // different things about the same rung — S3 prints `gated` in the tooltip and
  // still contributes `FAIL_FRESH` to the chip — so both are asserted here.
  it("A5 gated-but-counted: S1 green / S2 stale / S3 fresh-red ⇒ RED, not amber", () => {
    const r = combine(
      [
        c("S1", "GREEN_FRESH"),
        c("S2", "STALE_DEGRADED"),
        c("S3", "FAIL_FRESH"),
      ],
      STARTER_CEILING,
      NOW,
      STARTER_AXIS,
    );
    expect(r.chipColor).toBe("red");
    expect(r.achievedDepth).toBe(1);

    // End-to-end, and the tooltip half of the same case.
    const STALE = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    const m = buildCellModel(
      mergeRowsToMap([
        starterRow("shell", "green"),
        starterRow("runtime", "green", { observed_at: STALE }),
        starterRow("agentrun", "red"),
      ]),
      STARTER_CELL,
      NOW,
    );
    expect(m.chipColor).toBe("red");
    const byKind = new Map((m.ladderRungs ?? []).map((x) => [x.kind, x]));
    // The chip says red BECAUSE of S3; the tooltip says S3 is not credited.
    expect(byKind.get("S3")?.state).toBe("gated");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Part B — the structural invariants, permanent, in CI
// ───────────────────────────────────────────────────────────────────────────
//
// Input source, stated rather than implied: these run over models produced by
// the REAL `buildCellModel` on `LiveStatusMap`s synthesized IN PROCESS. "Not a
// fixture matrix" means not the frozen golden master, and specifically NOT a
// recorded staging snapshot — this runs in CI, where there is no live
// PocketBase, so an invariant that needed one would be unrunnable.

/** Every reachable per-rung state, as row states + an omission. */
const RUNG_SHAPES = ["green", "red", "stale-green", "missing"] as const;
type RungShape = (typeof RUNG_SHAPES)[number];

function liveFor(shapes: readonly RungShape[]) {
  const STALE = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
  const rows: StatusRow[] = [];
  STARTER_ROW_LEVELS.forEach((level, i) => {
    const shape = shapes[i];
    if (shape === "missing") return;
    if (shape === "stale-green")
      rows.push(starterRow(level, "green", { observed_at: STALE }));
    else rows.push(starterRow(level, shape === "red" ? "red" : "green"));
  });
  return mergeRowsToMap(rows);
}

describe("Part B(2) — no green chip over a non-green rung (chip-level FIRST)", () => {
  // (a) CHIP-LEVEL, and it binds unconditionally. The rung-level form alone
  // does NOT: under the `ladderKinds` truncation no rung ABOVE the stop renders
  // green — THE CELL DOES — so (b) would not have caught it.
  //
  // MUTATION THAT REDS THIS: truncate `STARTER_AXIS.ladderKinds` to `["S1"]`.
  // Every shape whose S1 is green and whose S2/S3 is not then folds green while
  // a rung at depth 2 <= ceiling 3 is non-green.
  it("(a) chip-level: green ⇒ every rung at depth ≤ ceiling is GREEN_FRESH", () => {
    let sawGreen = 0;
    for (const s1 of RUNG_SHAPES)
      for (const s2 of RUNG_SHAPES)
        for (const s3 of RUNG_SHAPES) {
          const shapes = [s1, s2, s3] as const;
          const m = buildCellModel(liveFor(shapes), STARTER_CELL, NOW);
          if (m.chipColor !== "green") continue;
          sawGreen++;
          const byDepth = new Map<number, string>();
          for (const r of m.ladderRungs ?? []) byDepth.set(r.depth, r.state);
          for (let d = 1; d <= m.ceilingDepth; d++) {
            expect(
              byDepth.get(d),
              `green chip with rung at depth ${d} = ${String(
                byDepth.get(d),
              )} for shapes ${shapes.join("/")}`,
            ).toBe("green");
          }
        }
    // NON-VACUITY: the quantifier must actually bind. A sweep in which nothing
    // ever renders green would pass the loop above by construction.
    expect(sawGreen).toBeGreaterThan(0);
  });

  // (b) RUNG-LEVEL — the machine form of "a gated rung never reads green".
  it("(b) rung-level: no rung above the stopping rung renders green", () => {
    let sawGated = 0;
    for (const s1 of RUNG_SHAPES)
      for (const s2 of RUNG_SHAPES)
        for (const s3 of RUNG_SHAPES) {
          const m = buildCellModel(
            liveFor([s1, s2, s3] as const),
            STARTER_CELL,
            NOW,
          );
          for (const r of m.ladderRungs ?? []) {
            if (r.depth <= m.achievedDepth + 1) continue;
            sawGated++;
            expect(
              r.state,
              `rung ${r.kind} above the stop for ${s1}/${s2}/${s3}`,
            ).toBe("gated");
          }
        }
    expect(sawGated).toBeGreaterThan(0);
  });
});

describe("Part B(3) — every declared rung reaches the fold", () => {
  // A rung the collector failed to emit fails HERE even when every rung it DID
  // emit is green — the one failure mode A1/A2/A5's fabricated ladders and a
  // live green check both miss.
  //
  // The quantifier is SCOPED, not sloppy: a `supported: false` column returns
  // the shared UNSUPPORTED singleton BEFORE the starter branch and carries no
  // `ladderRungs` at all, so this is asserted over cells that reach the fold.
  it("ladderRungs.length === ceilingDepth === ladderKinds.length, for every shape", () => {
    for (const s1 of RUNG_SHAPES)
      for (const s2 of RUNG_SHAPES)
        for (const s3 of RUNG_SHAPES) {
          const m = buildCellModel(
            liveFor([s1, s2, s3] as const),
            STARTER_CELL,
            NOW,
          );
          expect(m.ladderRungs).toBeDefined();
          expect(m.ladderRungs).toHaveLength(STARTER_AXIS.ladderKinds.length);
          expect(m.ceilingDepth).toBe(STARTER_AXIS.ladderKinds.length);
          expect(m.ladderRungs?.map((r) => r.kind)).toEqual([
            ...STARTER_AXIS.ladderKinds,
          ]);
        }
  });

  it("an UNSUPPORTED starter column carries no ladderRungs (the scope bound)", () => {
    const m = buildCellModel(
      mergeRowsToMap([]),
      { ...STARTER_CELL, isSupported: false },
      NOW,
    );
    expect(m.supported).toBe(false);
    expect(m.ladderRungs).toBeUndefined();
  });
});

describe("the tooltip restates the request, and names what was NOT run", () => {
  // The guard against the `"UI interactions work, no console errors"` defect
  // class is that each rung's assertion states the request the driver sends —
  // not a hand-written gloss. (The full contract test, which reads these
  // strings against `starter-smoke.ts`'s exported request constants, lands with
  // the Phase-0 driver change; this is the half that is assertable today.)
  it("each rung's assertion names its own request line", () => {
    const m = buildCellModel(
      mergeRowsToMap(STARTER_ROW_LEVELS.map((l) => starterRow(l, "green"))),
      STARTER_CELL,
      NOW,
    );
    const byKind = new Map((m.ladderRungs ?? []).map((r) => [r.kind, r]));
    expect(byKind.get("S1")?.assertion).toContain("GET /");
    expect(byKind.get("S2")?.assertion).toContain("/api/copilotkit/info");
    expect(byKind.get("S3")?.assertion).toContain("X-AIMock-Context");
    // S3 MUST say "mocked". `llamaindex` is red precisely because its client
    // ignored `OPENAI_BASE_URL` and hit real OpenAI — so a green S3 means a
    // round trip against the RECORDING succeeded, never that the integration
    // can talk to a model.
    expect(byKind.get("S3")?.assertion.toLowerCase()).toContain("mocked");
    // And no rung may claim DOM or console coverage: no browser rung exists.
    for (const r of m.ladderRungs ?? []) {
      expect(r.assertion.toLowerCase()).not.toContain("console");
      expect(r.assertion.toLowerCase()).not.toContain("dom");
    }
  });
});
