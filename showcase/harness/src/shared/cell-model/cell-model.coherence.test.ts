/**
 * Cross-field COHERENCE invariants (the convergence-audit structural lever).
 *
 * The unified engine's promise (§2/§2a) is that `chipColor`, `achievedDepth`,
 * `ceilingDepth`, `d6Effective`, and `isRegression` are ALL read off ONE
 * classified `RungContribution[]`, so they can never tell contradictory
 * stories. This suite encodes the exact cross-field implications the spec
 * guarantees (§2a-2/3/4 + the §4d `d6Effective` contract) and asserts them
 * over the WHOLE equivalence fixture matrix at once — a single structural
 * check that fails loudly if any future engine change lets two of those
 * outputs disagree, instead of relying on per-fixture golden values to notice.
 *
 * The guarantees asserted (each holds for every §4f row by construction):
 *  - INV1  isRegression ⟹ chip ∈ {red, amber}                    (§2a-3)
 *  - INV2  chip==green ⟹ achieved==ceiling ∧ !isRegression
 *          ∧ d6Effective ∈ {green, null}                          (§2a-2)
 *  - INV3  d6Effective==green ⟹ chip==green                       (§2a-2 / §4d)
 *  - INV4  d6Effective ∈ {red, amber} ⟹ chip==amber ∧ achieved==5 (§4c D6 soft-parity)
 *  - INV5  d6Effective==red ⟹ isRegression                        (§4d: a RED D6
 *          badge is a genuine FAIL_FRESH top rung; an INFRA/soft red must NOT
 *          surface as a product-red badge — the I-class coherence bug)
 *  - INV6  d6Effective ∈ {green, red, amber} ⟹ achieved>=5        (D6 gated on a
 *          contiguous-green ladder through D5, §4d)
 *  - INV7  chip==gray ∧ !isStaleCell ∧ no ladder gap below the red pill ∧ some
 *          depth pill reads red ⟹ EVERY red row THIS CELL contributes carries
 *          POSITIVE infra evidence                                (fail-safe
 *          polarity — see below; the per-cell quantification and BOTH
 *          carve-outs — U8 all-stale, and the I1 ladder gap — are
 *          load-bearing, see `assertChipStripCoherent`)
 *
 * INV7's SCOPE: the AGENT axis only. A starter cell has no depth strip, so the
 * precondition is structurally unsatisfiable there and INV7 gives the starter
 * axis NO coverage — asserted, not assumed, by `INV7 does not reach the starter
 * axis` at the foot of this file.
 *
 * INV7 is the invariant whose ABSENCE let a long-lived misreport ship. INV1–INV6
 * only relate `chipColor` to the other CHIP-side outputs; none of them inspects
 * the `d3`/`d4`/`d5`/`d6` `TestLevel`s (the depth pill strip), which are read
 * straight off the RAW fold and never consult the infra classifier. So the
 * engine could — and did — return one model object that simultaneously said
 * `d5.status === "red"` (strip renders `1P ✗`) and `chipColor === "gray"` (chip
 * renders the muted "no live data" treatment), and every chip-side invariant
 * still held.
 *
 * HOW MUCH OF THE MATRIX rendered that way on every cold load: an earlier
 * revision of this comment said "roughly 20%", but that figure carries no
 * recorded measurement and could not be reproduced, so do not quote it. What IS
 * derivable, from the production `status` collection on 2026-07-24: 155 of 1331
 * per-cell `(slug, feature)` pairs (~12%) had at least one red per-cell
 * `e2e:`/`d5:`/`d6:` rung, and every one of those was eligible for the
 * red-strip/gray-chip split because a cold load strips `signal` off all of them.
 * Folding in integration-level red rungs (`health:`/`chat:`/`tools:`/…) raises
 * the eligible share far higher (1018 of 1331 pairs, ~77%, sit under a slug with
 * at least one red rung of any level). The true rendered share lies between
 * those bounds and depends on which rung won each cell's fold — which this
 * snapshot cannot reconstruct. The invariant's justification does not need the
 * exact number: ONE incoherent cell is a misreport, and the defect was
 * systematic across every red-bearing cell rather than incidental.
 *
 * INV7 closes it in the ONLY safe direction: coherence must be reached by
 * fixing the CHIP upward, never by muting the strip. Deriving the strip from the
 * classified contributions instead would render `1P ✗` as `1P ?` and destroy the
 * only on-page element that was telling the truth — converting a visible
 * inconsistency into an invisible failure.
 */
import { describe, it, expect } from "vitest";
import { buildCellModel } from "./cell-model.js";
import { combine } from "./cell-model.combine.js";
import type {
  RungContribution,
  RungKind,
  ContributionKind,
} from "./cell-model.contribution.js";
import {
  signalHasInfraErrorClass,
  rankOfState,
  RED_RANK,
} from "./cell-model.contribution.js";
import type { CellModel, CellModelInput } from "./cell-model.js";
import type {
  LiveStatusMap,
  StarterLevel,
  State,
  StatusRow,
} from "./live-status.js";
import {
  keyFor,
  mergeRowsToMap,
  CATALOG_TO_D5_KEY,
  STARTER_LEVELS,
} from "./live-status.js";
import { E2E_STALE_AFTER_MS } from "./staleness.js";
import { FIXTURES, NOW } from "./cell-model.equivalence-fixtures.js";

type Coherable = Pick<
  CellModel,
  | "chipColor"
  | "achievedDepth"
  | "ceilingDepth"
  | "d6Effective"
  | "isRegression"
>;

/** Assert every cross-field implication the engine guarantees for one result. */
function assertCoherent(label: string, m: Coherable): void {
  const { chipColor, achievedDepth, ceilingDepth, d6Effective, isRegression } =
    m;

  // INV1 — a confirmed regression is never green and never gray.
  if (isRegression) {
    expect(
      ["red", "amber"],
      `${label}: INV1 isRegression⟹chip∈{red,amber}`,
    ).toContain(chipColor);
  }

  // INV2 — green is never wrong: complete, non-regressed, no red/amber D6.
  if (chipColor === "green") {
    expect(achievedDepth, `${label}: INV2 green⟹ach==ceil`).toBe(ceilingDepth);
    expect(isRegression, `${label}: INV2 green⟹!isRegression`).toBe(false);
    expect(
      [null, "green"],
      `${label}: INV2 green⟹d6Eff∈{green,null}`,
    ).toContain(d6Effective);
  }

  // INV3 — a green D6 badge only over a green chip.
  if (d6Effective === "green") {
    expect(chipColor, `${label}: INV3 d6Eff green⟹chip green`).toBe("green");
  }

  // INV4 — a non-green D6 badge is the soft-parity amber top over a green D5 ladder.
  if (d6Effective === "red" || d6Effective === "amber") {
    expect(chipColor, `${label}: INV4 d6Eff∈{red,amber}⟹chip amber`).toBe(
      "amber",
    );
    expect(achievedDepth, `${label}: INV4 d6Eff∈{red,amber}⟹ach==5`).toBe(5);
  }

  // INV5 — a RED D6 badge is a GENUINE regression (never an infra/soft red).
  if (d6Effective === "red") {
    expect(isRegression, `${label}: INV5 d6Eff red⟹isRegression`).toBe(true);
  }

  // INV6 — d6Effective is only meaningful on a ladder green through D5.
  if (d6Effective !== null) {
    expect(
      achievedDepth >= 5,
      `${label}: INV6 d6Eff!=null⟹ach>=5 (got ${achievedDepth})`,
    ).toBe(true);
  }
}

/**
 * The status-row keys ONE cell's chip and depth strip are derived from — the
 * same keyspace `buildCellModel` collects: D1 `health`, D2 `agent`, D3 `e2e`,
 * D4 `chat`/`tools`, and the D5/D6 per-cell families fanned out through
 * `CATALOG_TO_D5_KEY`.
 *
 * INV7 quantifies over exactly these rows. `live` is a WHOLE-MATRIX map, so a
 * red row in it may belong to a completely different column or feature; such a
 * row contributes nothing to this cell's chip and therefore says nothing about
 * whether this cell's gray chip is honest. Reading it would make INV7 fail on
 * unrelated map contents.
 *
 * STARTER AXIS — DELIBERATELY UNSUPPORTED, and INV7 has NO starter coverage.
 * This function used to return the four `starter:<column>/<level>` keys, which
 * read as coverage the invariant does not have: a starter cell carries no depth
 * strip at all (`buildStarterCellModelV2` returns `NOT_WIRED_LEVEL` — `exists:
 * false`, `status: null` — for d3-d6), so `stripReadsRed` is false for EVERY
 * starter cell however red its rows are, and `assertChipStripCoherent`
 * short-circuits before it ever gets here. The branch was therefore
 * unreachable. It is a throw instead of a silent fallthrough so that IF the
 * starter axis ever grows a depth strip, INV7 fails loudly and demands the
 * keyspace back rather than quietly measuring the agent keyspace of a cell that
 * has none. `INV7 does not reach the starter axis` (below) pins the structural
 * reason and fails if it stops holding.
 */
function contributingKeys(input: CellModelInput): string[] {
  if (input.probeAxis === "starter") {
    throw new Error(
      "INV7 has no coverage of the starter axis: a starter cell has no depth " +
        "strip, so the invariant's precondition cannot hold and this keyspace " +
        "is unreachable. If a starter cell reached here the axis has gained a " +
        "strip — restore the starter keyspace and give INV7 real coverage.",
    );
  }
  // Mirrors `buildCellModel`'s empty-string→null normalization.
  const featureId = input.featureId === "" ? null : input.featureId;
  const keys = [keyFor("health", input.slug), keyFor("agent", input.slug)];
  // A null-feature (liveness-only) cell has no D3+ rungs.
  if (featureId === null) return keys;
  keys.push(
    keyFor("e2e", input.slug, featureId),
    keyFor("chat", input.slug),
    keyFor("tools", input.slug),
  );
  for (const ft of CATALOG_TO_D5_KEY[featureId] ?? []) {
    keys.push(keyFor("d5", input.slug, ft), keyFor("d6", input.slug, ft));
  }
  return keys;
}

/**
 * The status-row keys of ONE agent-axis ladder rung, or `null` when the rung is
 * structurally absent for this cell (D5/D6 on a D5-unmapped feature — those are
 * never attached as rungs, so `scanWorst` skips them without breaking).
 * Mirrors `collectAgentLadder`'s per-rung gather.
 */
function rungKeys(
  input: CellModelInput,
  depth: 3 | 4 | 5,
): readonly string[] | null {
  const featureId = input.featureId === "" ? null : input.featureId;
  if (featureId === null) return null; // null-feature cell: no D3+ rungs
  if (depth === 3) return [keyFor("e2e", input.slug, featureId)];
  if (depth === 4)
    return [keyFor("chat", input.slug), keyFor("tools", input.slug)];
  const d5 = CATALOG_TO_D5_KEY[featureId];
  if (!d5 || d5.length === 0) return null; // D5 unmapped ⇒ no D5 rung at all
  return d5.map((ft) => keyFor("d5", input.slug, ft));
}

/**
 * The depth at which the chip's ladder walk STOPPED for want of any
 * observation — i.e. the rung `scanWorst` folds as `ABSENT` and `break`s on
 * (invariant I1, `cell-model.combine.ts`), or `null` if the walk never broke.
 *
 * `scanWorst` walks D3→D4→D5 and breaks at the FIRST `ABSENT`/`STUB` rung, so
 * the shallowest such rung IS the break point. And for a D3/D4/D5 rung,
 * `classifyRung` yields `ABSENT` EXACTLY when the rung has no present row:
 * its other `ABSENT` return needs `foldFamily().worstState === null`, which is
 * unreachable with rows present (the first row always sets `worstState`). So
 * "no row for any of the rung's keys" is an exact test for the break, not an
 * approximation — deliberately NOT the strip's `status === null`, which also
 * covers the `anyExpectedMissing` → `NO_DATA` collapse (a rung that does have
 * an observation, and does NOT stop the walk).
 */
function ladderGapDepth(
  live: LiveStatusMap,
  input: CellModelInput,
): 3 | 4 | 5 | null {
  for (const depth of [3, 4, 5] as const) {
    const keys = rungKeys(input, depth);
    if (keys === null) continue;
    if (keys.every((k) => live.get(k) === undefined)) return depth;
  }
  return null;
}

/** Shallowest depth whose pill renders red, or `null` if the strip has none. */
function redPillDepth(m: CellModel): 3 | 4 | 5 | 6 | null {
  for (const [depth, lvl] of [
    [3, m.d3],
    [4, m.d4],
    [5, m.d5],
    [6, m.d6],
  ] as const) {
    if (lvl !== null && lvl.exists && lvl.status === "red") return depth;
  }
  return null;
}

/**
 * INV7 — CHIP/STRIP coherence with the fail-safe polarity. Needs the input rows
 * and the cell's `input` (not just the model) because the legitimate
 * gray-over-a-red case is defined by POSITIVE infra evidence in the rows'
 * `signal` blobs, and only THIS cell's rows can supply it.
 *
 * A gray chip means "no live verdict to show". It is only honest above a red
 * depth pill when every contributing red row actually SAYS the failure was
 * infra. A red row with a stripped `signal` says nothing at all — that is a
 * PENDING attribution, and must surface as red/amber, not gray.
 *
 * `opts.ladderGapAllowance` exists ONLY so a test can re-run the same input with
 * the I1 allowance disabled and prove the allowance is what passed it (the
 * mutation proof lives in the suite instead of in a reviewer's scratch edit).
 * Production callers never pass it.
 */
function assertChipStripCoherent(
  label: string,
  m: CellModel,
  live: LiveStatusMap,
  input: CellModelInput,
  opts: { ladderGapAllowance?: boolean } = {},
): void {
  const { ladderGapAllowance = true } = opts;
  // A pill can be null entirely (an unsupported column has no strip at all).
  const redDepth = redPillDepth(m);
  if (m.chipColor !== "gray" || redDepth === null) return;

  // U8 EXEMPTION (§7.2/§6.4). `buildCellModel` force-grays an ALL-STALE cell on
  // every path (`if (isStaleCell && chipColor !== "gray") chipColor = "gray"`,
  // agent + starter + null-feature), deliberately folding ANY stale colour —
  // red INCLUDED — to the "re-sweep pending" gray. That gray is a RECENCY claim
  // about the whole cell, not an infra attribution for the red pill, so
  // gray-over-red is the INTENDED rendering here and owes no infra evidence.
  // Without this carve-out INV7 fails every legitimate all-stale-with-a-red
  // cell; the current fixture variants are green/degraded only, so the hole is
  // latent rather than firing.
  if (m.isStaleCell) return;

  // I1 LADDER-GAP ALLOWANCE (round-2 a8 / round-1 a4(iii)). `scanWorst`
  // (`cell-model.combine.ts`) walks D3→D4→D5 and STOPS at the first rung with
  // no observation, folding it as `ABSENT`: *"a gap grays the cell — rungs above
  // the gap are not contiguous, I1"*. So when the gap is strictly BELOW the
  // shallowest red pill, the chip's verdict was decided at the gap and the red
  // rung was never consulted at all. That gray is a NO-DATA claim about the
  // ladder's contiguity, not an infra attribution for the red above it, so no
  // infra evidence is owed and INV7 must not fire — before this allowance it
  // false-failed on the ordinary shape "no `e2e:` row + red `chat:<slug>`"
  // (`e2e` rows come from a separate sweep; `chat:`/`tools:` are
  // integration-scoped and shared by every feature cell of the column).
  //
  // KNOWN GAP, DELIBERATELY NOT ASSERTED. The engine's I1 break is itself a
  // masking bug: a fresh product-red above a gap renders gray (an exhaustive
  // sweep put it at 19,328 of 279,936 rung combinations, none infra-justified).
  // Fixing it means `break` → `continue` in `scanWorst`, which REVERSES I1,
  // re-verdicts cells across the matrix and needs its own golden-master
  // re-freeze and live value test — it is tracked as its own change (round-2
  // d4), and `combine.ts` is untouched by this PR. INV7 is therefore silent
  // about the residual masking ON PURPOSE, and only about that: the allowance
  // is one-directional (a gap ABOVE the red excuses nothing, because the walk
  // DID reach the red) and it never fires without a witness rung.
  //
  // `redPillDepth` deliberately reports the SHALLOWEST red pill, so a strip with
  // a red BELOW the gap and another ABOVE it is NOT excused — the lower red was
  // consulted, and the gray does owe evidence for it.
  //
  // TWO-SIDED: `PASSES a gray chip over a red pill ABOVE a ladder gap` pins the
  // engine behaviour excused here. When the gap-break is fixed its chip stops
  // being gray and that test fails loudly — the signal to delete this block
  // rather than let it excuse a shape the engine no longer produces.
  const gapDepth = ladderGapAllowance ? ladderGapDepth(live, input) : null;
  if (gapDepth !== null && gapDepth < redDepth) return;

  const redRows = contributingKeys(input)
    .map((k) => live.get(k))
    .filter(
      (r): r is StatusRow =>
        r !== undefined && rankOfState(r.state) >= RED_RANK,
    );
  // The strip can only read red because a CONTRIBUTING row folded red, so an
  // empty set here means `contributingKeys` has drifted from the engine's
  // keyspace and the invariant has gone vacuous — fail loudly instead of
  // silently passing everything.
  expect(
    redRows.length,
    `${label}: INV7 strip reads red but no contributing red row was found — ` +
      `\`contributingKeys\` has drifted from the keyspace buildCellModel collects.`,
  ).toBeGreaterThan(0);
  for (const r of redRows) {
    expect(
      signalHasInfraErrorClass(r.signal),
      `${label}: INV7 gray chip over a red pill requires POSITIVE infra ` +
        `evidence on every contributing red row — ${r.key} has none (signal ${
          r.signal === undefined
            ? "STRIPPED (pending)"
            : JSON.stringify(r.signal)
        }). A red whose cause is merely unknown must render red, not gray.`,
    ).toBe(true);
  }
}

describe("cell-model coherence — cross-field invariants over the fixture matrix", () => {
  for (const f of FIXTURES) {
    it(`coheres for fixture: ${f.name}`, () => {
      const m = buildCellModel(f.live, f.input, NOW);
      assertCoherent(f.name, m);
      assertChipStripCoherent(f.name, m, f.live, f.input);
    });
  }
});

// ── Null-feature (liveness-only) coherence — not represented in the keyFor
//    fixture matrix, so exercised directly on `combine` (§F, §5a). ───────────
describe("cell-model coherence — null-feature D1/D2 contiguity", () => {
  const c = (
    kind: RungKind,
    contribution: ContributionKind,
  ): RungContribution => ({
    kind,
    contribution,
    rawStatus:
      contribution === "GREEN_FRESH"
        ? "green"
        : contribution === "FAIL_FRESH"
          ? "red"
          : null,
    // Match the real classifier's shape: `classifyRung` reports
    // `freshestAgeMs: null` for a rung it classifies ABSENT (no rows at all, or
    // a fold that produced no state) — there is no observation to age. Only a
    // rung with a datable contributing row ever carries a number, so a
    // synthetic ABSENT with `0` ("swept just now") is a shape the engine never
    // produces.
    freshestAgeMs: contribution === "ABSENT" ? null : 0,
  });

  it("absent D1 + green D2 → gray chip AND achieved 0 (contiguity broken at D1)", () => {
    const r = combine([c("D1", "ABSENT"), c("D2", "GREEN_FRESH")], 2, NOW);
    // The flagged incoherence: a gray null-feature chip must NOT report the
    // ceiling as reached. D1 absent breaks the ladder at the base.
    expect(r.chipColor).toBe("gray");
    expect(r.achievedDepth).toBeLessThan(r.ceilingDepth);
    expect(r.achievedDepth).toBe(0);
    // A gray null-feature cell has not verified its liveness ceiling.
    assertCoherent("null-feature-absent-d1", r);
    if (r.chipColor === "gray") expect(r.achievedDepth).toBeLessThan(2);
  });

  it("green D1 + absent D2 → gray chip AND achieved 1 (< ceiling 2)", () => {
    const r = combine([c("D1", "GREEN_FRESH"), c("D2", "ABSENT")], 2, NOW);
    expect(r.chipColor).toBe("gray");
    expect(r.achievedDepth).toBe(1);
    expect(r.achievedDepth).toBeLessThan(r.ceilingDepth);
    assertCoherent("null-feature-absent-d2", r);
  });

  it("green D1 + green D2 → green chip AND achieved 2 (== ceiling)", () => {
    const r = combine([c("D1", "GREEN_FRESH"), c("D2", "GREEN_FRESH")], 2, NOW);
    expect(r.chipColor).toBe("green");
    expect(r.achievedDepth).toBe(2);
    assertCoherent("null-feature-all-green", r);
  });
});

// ── INV7's own soundness: quantification scope + the U8 stale exemption ─────
//
// The fixture matrix in `FIXTURES` happens to contain no all-stale cell with a
// red row and no cross-cell rows, so INV7's two soundness holes are invisible
// there. These cases exercise them DIRECTLY: the first two must PASS (they are
// legitimate renderings that INV7 must not flag), and the last group must FAIL
// (INV7 must keep its teeth on a genuine chip/strip incoherence).
describe("cell-model coherence — INV7 soundness (scope + stale exemption)", () => {
  const SLUG = "acme";
  const OTHER_SLUG = "zeta";
  const FEATURE = "agentic-chat";
  const FRESH_AT = new Date(NOW - 60_000).toISOString();
  const STALE_AT = new Date(NOW - E2E_STALE_AFTER_MS - 60_000).toISOString();

  function mkRow(
    key: string,
    state: State,
    opts: { observedAt?: string; signal?: unknown } = {},
  ): StatusRow {
    const observed = opts.observedAt ?? FRESH_AT;
    const [dimension = ""] = key.split(":");
    const isRed = state === "red";
    return {
      id: `id-${key}`,
      key,
      dimension,
      state,
      signal: "signal" in opts ? opts.signal : null,
      observed_at: observed,
      transitioned_at: observed,
      fail_count: isRed ? 3 : 0,
      first_failure_at: isRed ? observed : null,
    };
  }

  const input: CellModelInput = {
    slug: SLUG,
    featureId: FEATURE,
    isSupported: true,
    isWired: true,
  };

  /**
   * The full agent ladder for `acme/agentic-chat`, every rung green, with the
   * D5 row replaced by `d5Row`. `observedAt` ages EVERY row uniformly so the
   * caller can produce an all-stale (U8) cell.
   */
  function ladder(d5Row: StatusRow, observedAt: string): StatusRow[] {
    return [
      mkRow(keyFor("health", SLUG), "green", { observedAt }),
      mkRow(keyFor("agent", SLUG), "green", { observedAt }),
      mkRow(keyFor("e2e", SLUG, FEATURE), "green", { observedAt }),
      mkRow(keyFor("chat", SLUG), "green", { observedAt }),
      mkRow(keyFor("tools", SLUG), "green", { observedAt }),
      d5Row,
      mkRow(keyFor("d6", SLUG, FEATURE), "green", { observedAt }),
    ];
  }

  it("PASSES an all-stale cell whose red row has NO infra evidence (U8 force-gray)", () => {
    const live = mergeRowsToMap(
      ladder(
        mkRow(keyFor("d5", SLUG, FEATURE), "red", { observedAt: STALE_AT }),
        STALE_AT,
      ),
    );
    const m = buildCellModel(live, input, NOW);
    // Precondition: this really IS the shape INV7 inspects — U8 force-grayed a
    // chip that the classifier coloured red, over a strip that still reads red.
    expect(m.isStaleCell).toBe(true);
    expect(m.chipColor).toBe("gray");
    expect(m.d5?.status).toBe("red");
    // The gray is a RECENCY claim about the whole cell ("re-sweep pending"),
    // not an infra claim about the red pill — so no infra evidence is owed.
    assertChipStripCoherent("stale-red-no-infra", m, live, input);
  });

  it("PASSES a legitimately-gray infra cell when an UNRELATED cell's row is red", () => {
    const live = mergeRowsToMap(
      ladder(
        mkRow(keyFor("d5", SLUG, FEATURE), "red", {
          signal: { errorClass: "driver-error" },
        }),
        FRESH_AT,
      ),
      // A red row belonging to a DIFFERENT column. It contributes nothing to
      // `acme/agentic-chat` and says nothing about whether ITS gray is honest.
      [mkRow(keyFor("e2e", OTHER_SLUG, FEATURE), "red")],
    );
    const m = buildCellModel(live, input, NOW);
    expect(m.isStaleCell).toBe(false);
    expect(m.chipColor).toBe("gray");
    expect(m.d5?.status).toBe("red");
    assertChipStripCoherent("infra-gray-with-unrelated-red", m, live, input);
  });

  it("PASSES the same infra cell with no unrelated rows (control)", () => {
    const live = mergeRowsToMap(
      ladder(
        mkRow(keyFor("d5", SLUG, FEATURE), "red", {
          signal: { errorClass: "driver-error" },
        }),
        FRESH_AT,
      ),
    );
    const m = buildCellModel(live, input, NOW);
    expect(m.chipColor).toBe("gray");
    assertChipStripCoherent("infra-gray-control", m, live, input);
  });

  // ── Teeth: INV7 must still FAIL a genuine gray-over-red incoherence.
  //    The polarity flip removes the class this PR is about (a red grayed for
  //    want of a `signal` blob), so for THAT class the chip has to be perturbed
  //    to gray on an otherwise-real model. Other masking mechanisms survive it
  //    and need no perturbation at all — see the unperturbed teeth case at the
  //    foot of this describe.
  const teethCases: Array<{ name: string; signal: unknown }> = [
    { name: "signal STRIPPED (pending attribution)", signal: undefined },
    { name: "signal present but not infra-classed", signal: null },
    {
      name: "signal carries a PRODUCT error class",
      signal: { errorClass: "assertion-failed" },
    },
  ];
  for (const tc of teethCases) {
    it(`FAILS a non-stale gray chip over a red D5 pill — ${tc.name}`, () => {
      const live = mergeRowsToMap(
        ladder(
          mkRow(keyFor("d5", SLUG, FEATURE), "red", { signal: tc.signal }),
          FRESH_AT,
        ),
      );
      const real = buildCellModel(live, input, NOW);
      expect(real.isStaleCell).toBe(false);
      expect(real.d5?.status).toBe("red");
      const perturbed: CellModel = { ...real, chipColor: "gray" };
      expect(() =>
        assertChipStripCoherent("teeth-d5", perturbed, live, input),
      ).toThrow(/INV7/);
    });
  }

  it("FAILS a non-stale gray chip over a red D3 pill (teeth in another family)", () => {
    const live = mergeRowsToMap([
      mkRow(keyFor("health", SLUG), "green"),
      mkRow(keyFor("agent", SLUG), "green"),
      mkRow(keyFor("e2e", SLUG, FEATURE), "red", { signal: undefined }),
      mkRow(keyFor("chat", SLUG), "green"),
      mkRow(keyFor("tools", SLUG), "green"),
      mkRow(keyFor("d5", SLUG, FEATURE), "green"),
      mkRow(keyFor("d6", SLUG, FEATURE), "green"),
    ]);
    const real = buildCellModel(live, input, NOW);
    expect(real.d3?.status).toBe("red");
    const perturbed: CellModel = { ...real, chipColor: "gray" };
    expect(() =>
      assertChipStripCoherent("teeth-d3", perturbed, live, input),
    ).toThrow(/INV7/);
  });

  // ── The I1 LADDER-GAP allowance (a8 / round-1 a4(iii)). ───────────────────
  //
  // `ladder()` above always emits every rung, so the fixture matrix and the
  // cases above never produce the shape below: a rung with NO row at all,
  // strictly under a fresh product-red rung. `scanWorst` stops at the
  // row-less rung (I1), so the red above it never reaches the chip and the
  // chip renders the gap's gray. INV7 must not read that gray as an infra
  // attribution for a red it provably never consulted.

  /**
   * `acme/agentic-chat` with NO `e2e:` row (the D3 rung has no observation at
   * all) and a fresh, sustained, PRODUCT-class red `chat:acme` (D4). Both legs
   * are ordinary production shapes: `e2e` rows are emitted by a separate sweep
   * that can simply not have run for a feature, and `chat:`/`tools:` are
   * integration-scoped, so one red `chat:` row is shared by every feature cell
   * of the column.
   */
  function gapLadderRows(): StatusRow[] {
    return [
      mkRow(keyFor("health", SLUG), "green"),
      mkRow(keyFor("agent", SLUG), "green"),
      // D3: NO `e2e:acme/agentic-chat` row — the ladder gap.
      mkRow(keyFor("chat", SLUG), "red", {
        signal: { errorClass: "conversation-error" },
      }),
      mkRow(keyFor("tools", SLUG), "green"),
      mkRow(keyFor("d5", SLUG, FEATURE), "green"),
      mkRow(keyFor("d6", SLUG, FEATURE), "green"),
    ];
  }

  it("PASSES a gray chip over a red pill ABOVE a ladder gap (I1 allowance)", () => {
    const live = mergeRowsToMap(gapLadderRows());
    const m = buildCellModel(live, input, NOW);

    // ── CANARY (two-sidedness). These five assertions pin the engine
    //    behaviour the allowance exists to excuse. If the `scanWorst`
    //    gap-break is ever changed so a red above a gap reaches the chip
    //    (the `break`→`continue` fix tracked as round-2 d4), the chip here
    //    stops being gray and THIS assertion fails loudly — which is the
    //    signal to delete the allowance in `assertChipStripCoherent` rather
    //    than let it go on silently excusing a shape the engine no longer
    //    produces.
    expect(
      m.chipColor,
      "I1 gap-break canary: the engine no longer grays a red above a ladder " +
        "gap — re-examine (and probably delete) the LADDER-GAP allowance in " +
        "`assertChipStripCoherent`.",
    ).toBe("gray");
    expect(m.d3?.status, "D3 has no row ⇒ no verdict").toBe(null);
    expect(m.d4?.status, "D4 folded the red chat row").toBe("red");
    expect(m.isStaleCell, "not the U8 exemption — every row is fresh").toBe(
      false,
    );
    // The red row carries a PRODUCT class, so the infra branch cannot excuse
    // it: without the gap allowance INV7 has nothing to fall back on.
    expect(signalHasInfraErrorClass(m.d4?.row?.signal)).toBe(false);

    // GREEN: the allowance recognises the gap and passes the shape.
    assertChipStripCoherent("i1-gap-over-red", m, live, input);

    // MUTATION PROOF: with the allowance disabled, this exact shape throws —
    // so the allowance (not some other early return) is what passes it.
    expect(() =>
      assertChipStripCoherent("i1-gap-over-red", m, live, input, {
        ladderGapAllowance: false,
      }),
    ).toThrow(/INV7/);
  });

  it("FAILS when the gap is ABOVE the red pill (the allowance is one-directional)", () => {
    // D3 red with NO infra evidence, D5 row-less. A gap exists — but it is
    // ABOVE the red, so `scanWorst` DID consult the red and the gray is an
    // attribution for it. This is the non-gap-induced incoherence class, and
    // it proves `gapDepth < redPillDepth` is load-bearing rather than "any gap
    // anywhere excuses everything".
    const live = mergeRowsToMap([
      mkRow(keyFor("health", SLUG), "green"),
      mkRow(keyFor("agent", SLUG), "green"),
      mkRow(keyFor("e2e", SLUG, FEATURE), "red", { signal: undefined }),
      mkRow(keyFor("chat", SLUG), "green"),
      mkRow(keyFor("tools", SLUG), "green"),
      // NO d5 row — a gap at D5, i.e. ABOVE the red D3.
      mkRow(keyFor("d6", SLUG, FEATURE), "green"),
    ]);
    const real = buildCellModel(live, input, NOW);
    expect(real.d3?.status).toBe("red");
    expect(real.d5?.status, "D5 has no row ⇒ a gap, but above the red").toBe(
      null,
    );
    const perturbed: CellModel = { ...real, chipColor: "gray" };
    expect(() =>
      assertChipStripCoherent("teeth-gap-above-red", perturbed, live, input),
    ).toThrow(/INV7/);
  });

  it("FAILS a gray chip over a red pill when the ladder is GAPLESS (non-gap incoherence)", () => {
    // Every rung has a row; the red D4 is fresh, sustained and product-class.
    // Nothing about this shape is a contiguity claim, so INV7 must fire — the
    // allowance must not have widened into "gray over red is always fine".
    const live = mergeRowsToMap([
      mkRow(keyFor("health", SLUG), "green"),
      mkRow(keyFor("agent", SLUG), "green"),
      mkRow(keyFor("e2e", SLUG, FEATURE), "green"),
      mkRow(keyFor("chat", SLUG), "red", {
        signal: { errorClass: "conversation-error" },
      }),
      mkRow(keyFor("tools", SLUG), "green"),
      mkRow(keyFor("d5", SLUG, FEATURE), "green"),
      mkRow(keyFor("d6", SLUG, FEATURE), "green"),
    ]);
    const real = buildCellModel(live, input, NOW);
    expect(real.d3?.status, "no gap: D3 has a verdict").toBe("green");
    expect(real.d4?.status).toBe("red");
    const perturbed: CellModel = { ...real, chipColor: "gray" };
    expect(() =>
      assertChipStripCoherent("teeth-gapless-d4", perturbed, live, input),
    ).toThrow(/INV7/);
  });

  it("FAILS on UNPERTURBED engine output: an infra-red D4 grays a product-red D6", () => {
    // The sharpest teeth case, because nothing is perturbed. `scanWorst` folds
    // D3→D5 only, so a red D6 never reaches the chip; an INFRA_RED_FRESH D4
    // (gray severity) therefore decides the chip while the D6 pill still
    // renders a fresh, sustained PRODUCT red. The ladder is GAPLESS — every
    // rung has an observation — so the I1 allowance does not apply and must
    // not: this is a real red rendered as benign, which is precisely what INV7
    // is for. It is a DIFFERENT masking mechanism from the I1 gap-break (round-2
    // d4) and from the `signal`-polarity class this PR fixes; both live in
    // `combine.ts`/`cell-model.contribution.ts` and are out of this PR's scope,
    // so the engine still emits this shape today.
    //
    // If that ever changes, `expect(m.chipColor).toBe("gray")` fails loudly and
    // this case should be re-derived rather than deleted — INV7's teeth on
    // unperturbed output are the whole point of keeping it.
    const live = mergeRowsToMap([
      mkRow(keyFor("health", SLUG), "green"),
      mkRow(keyFor("agent", SLUG), "green"),
      mkRow(keyFor("e2e", SLUG, FEATURE), "green"),
      mkRow(keyFor("chat", SLUG), "red", {
        signal: { errorClass: "driver-error" },
      }),
      mkRow(keyFor("tools", SLUG), "green"),
      mkRow(keyFor("d5", SLUG, FEATURE), "green"),
      mkRow(keyFor("d6", SLUG, FEATURE), "red", {
        signal: { errorClass: "assertion-failed" },
      }),
    ]);
    const m = buildCellModel(live, input, NOW);
    expect(m.chipColor).toBe("gray");
    expect(m.isStaleCell).toBe(false);
    expect(m.d6?.status).toBe("red");
    // GAPLESS: every rung of the chip's scan has an observation.
    expect(m.d3?.status).toBe("green");
    expect(m.d4?.status).toBe("red");
    expect(m.d5?.status).toBe("green");
    // No perturbation — INV7 rejects the model the engine actually built.
    expect(() =>
      assertChipStripCoherent("teeth-unperturbed-d6", m, live, input),
    ).toThrow(/INV7/);
  });
});

// ── INV7's reach: the STARTER axis is STRUCTURALLY out of scope ─────────────
//
// b24: `contributingKeys` used to carry a `probeAxis === "starter"` branch,
// which read as starter coverage INV7 does not have. A starter cell has no
// depth strip at all (`buildStarterCellModelV2` returns `NOT_WIRED_LEVEL` for
// d3-d6), so `stripReadsRed` is false for EVERY starter cell and INV7's
// precondition can never hold — no matter how red the starter rows are. Rather
// than imply coverage through unreachable code, the branch is now a loud throw
// and this test pins the structural reason it is unreachable: if the starter
// axis ever grows a depth strip, this test fails and the branch must come back.
describe("cell-model coherence — INV7 does not reach the starter axis", () => {
  const COL = "acme";
  const FRESH_AT = new Date(NOW - 60_000).toISOString();

  const starterInput: CellModelInput = {
    slug: COL,
    featureId: "starter",
    isSupported: true,
    isWired: true,
    probeAxis: "starter",
  };

  it("a hard-red starter cell exposes NO depth strip, so INV7 never engages", () => {
    const live = mergeRowsToMap(
      (STARTER_LEVELS as readonly StarterLevel[]).map((level) => ({
        id: `id-starter-${level}`,
        key: keyFor("starter", COL, level),
        dimension: "starter",
        state: "red" as State,
        signal: { errorClass: "assertion-failed" },
        observed_at: FRESH_AT,
        transitioned_at: FRESH_AT,
        fail_count: 9,
        first_failure_at: FRESH_AT,
      })),
    );
    const m = buildCellModel(live, starterInput, NOW);
    expect(m.chipColor).toBe("red");
    // The structural reason INV7 is inapplicable: no pill can read red.
    for (const [name, lvl] of [
      ["d3", m.d3],
      ["d4", m.d4],
      ["d5", m.d5],
      ["d6", m.d6],
    ] as const) {
      expect(lvl, `${name} exists on a starter cell?`).not.toBeNull();
      expect(lvl?.exists, `starter ${name}.exists`).toBe(false);
      expect(lvl?.status, `starter ${name}.status`).toBe(null);
    }
    // So INV7 short-circuits on `!stripReadsRed` and never reaches
    // `contributingKeys` — which would throw if it did.
    assertChipStripCoherent("starter-hard-red", m, live, starterInput);
  });

  it("`contributingKeys` refuses a starter input rather than imply coverage", () => {
    expect(() => contributingKeys(starterInput)).toThrow(/starter axis/);
  });
});
