/**
 * The uniform combination fold — Stage C of the unified cell-model pipeline
 * (spec §4). ONE walk over ONE ordered `RungContribution[]` yields EVERY ladder
 * output: `chipColor`, `achievedDepth`, `ceilingDepth`, `d6Effective`, and
 * `isRegression`. No output field is derived by its own predicate chain
 * (guarantee §2a-1), and the D1/D2 liveness gate is applied asymmetrically per
 * §F (absent/stale D1/D2 non-gating; only a present fresh-red D1/D2 gates).
 *
 * The fold is AXIS-AGNOSTIC. Every place it used to name a `D<n>` literal now
 * reads a `LadderAxis` descriptor supplied by the caller (`AGENT_AXIS`,
 * `LIVENESS_AXIS`, `STARTER_AXIS`). That is what lets the starter ladder be
 * folded by THIS function rather than by a parallel lookalike — and the axis
 * descriptor, not a derived boolean, is what states which ladder is in play.
 *
 * Pure leaf: imports only the classifier's vocabulary + type-only names.
 */

import type { TestStatus, ChipColor } from "./cell-model.js";
import type { RungContribution, RungKind } from "./cell-model.contribution.js";
import { worseOf, contributionToColor } from "./cell-model.contribution.js";

export type LadderDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface CombineResult {
  chipColor: ChipColor;
  achievedDepth: LadderDepth;
  ceilingDepth: LadderDepth;
  d6Effective: TestStatus;
  isRegression: boolean;
}

const DEPTH_OF: Readonly<Record<RungKind, LadderDepth>> = {
  D1: 1,
  D2: 2,
  D3: 3,
  D4: 4,
  D5: 5,
  D6: 6,
  // The starter axis's rungs. The `D`/`S` prefix is what keeps the two axes'
  // kind names disjoint inside one union; the DEPTHS share one integer space.
  // The prefix is an INTERNAL identifier only — a starter chip RENDERS `D1`/
  // `D2`/`D3`, the same depth notation as a feature chip, because `D` is read
  // as "depth" and depth is contextual. The kinds cannot be renamed to match:
  // `firstStrikeConfig` and `STALE_WINDOW_BY_KIND` are `Record<RungKind, _>`
  // and hold DIFFERENT values for `S<n>` than for `D<n>` at the same depth.
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4,
  S5: 5,
  S6: 6,
};

/**
 * The description of ONE ladder axis — everything the fold used to hardcode as
 * `D<n>` string literals, stated by the caller instead.
 *
 * There are exactly three, all declared below. A fourth axis is a new constant;
 * it is never a new branch inside the fold.
 */
export interface LadderAxis {
  /** Rungs under the §F asymmetric liveness gate (present fresh-red dominates). */
  readonly gateKinds: readonly RungKind[];
  /** An ABSENT/STUB gate rung breaks the contiguous-green walk. */
  readonly gateGapBreaks: boolean;
  /**
   * The worst-wins scan set for `computeChip`, depth-ordered. STATIC per axis:
   * always the axis's COMPLETE declared rung set, never truncated per cell.
   *
   * Truncating this per cell is NOT a permitted reading. A `["S1"]` truncation
   * renders a starter cell GREEN at `D1` over a fresh-red S2 — the exact
   * defect the starter ladder exists to close — while still satisfying an
   * all-red assertion. `starter-axis-invariants.test.ts` pins
   * `length === ceiling`, and `starter-ladder.redgreen.test.ts`'s chip-level
   * predicate ("green ⇒ every rung at depth ≤ ceiling is GREEN_FRESH") reds the
   * truncation directly.
   */
  readonly ladderKinds: readonly RungKind[];
  /** The soft-parity top exception, or null when the axis has none. */
  readonly softTop: {
    readonly kind: RungKind;
    readonly atCeiling: LadderDepth;
  } | null;
  /** All-green through `ladderKinds`, no gap, no softTop ⇒ green (true) or gray (false). */
  readonly ceilingIsComplete: boolean;
}

/**
 * The agent-axis (feature) ladder: D1/D2 gate, D3→D5 worst-wins, D6 soft-parity
 * top. `ceilingIsComplete: false` — a D4 ceiling (D5 unmapped) is not a complete
 * verification level, so an all-green ladder there is gray, not green (A3).
 */
export const AGENT_AXIS: LadderAxis = {
  gateKinds: ["D1", "D2"],
  gateGapBreaks: false,
  ladderKinds: ["D3", "D4", "D5"],
  softTop: { kind: "D6", atCeiling: 6 },
  ceilingIsComplete: false,
};

/**
 * The null-feature (liveness-only) ladder: D1/D2 ARE the ladder, so they are
 * both the gate and the scan set, and an ABSENT/STUB gate rung breaks
 * contiguity (there is no higher rung to re-establish it).
 */
export const LIVENESS_AXIS: LadderAxis = {
  gateKinds: ["D1", "D2"],
  gateGapBreaks: true,
  ladderKinds: ["D1", "D2"],
  softTop: null,
  ceilingIsComplete: true,
};

/**
 * The starter ladder's uniform ceiling. Declared as an INDEPENDENT literal, not
 * as `STARTER_AXIS.ladderKinds.length`: derived, the invariant test that pins
 * the two together would be a tautology and therefore decorative.
 *
 * S4 `toolrun` is designed and deferred to v1.1; when it lands, `ladderKinds`
 * gains `"S4"` and this becomes 4 — for every provisioned column at once. A
 * per-column ceiling BELOW the axis length is forbidden; if one is ever needed
 * it is a second axis constant, never a truncation of this one.
 */
export const STARTER_CEILING = 3 as const;

/**
 * The starter ladder: S1 `shell` → S2 `runtime` → S3 `agentrun`.
 *
 * No gate rungs. The §F gate exists because D1/D2 are a SEPARATE liveness probe
 * on a different cadence whose absence or staleness must not gate the agent
 * ladder. No such asymmetry exists here: all starter rungs come from one driver
 * run, one tick, depth-ordered — so they are ordinary contiguous rungs, and a
 * fresh-red S2 stops the walk at achieved 1 and colours the chip red.
 *
 * `ceilingIsComplete: true` and `softTop: null` are two INDEPENDENT inputs on
 * purpose: a single boolean could not express this axis, because the `true`
 * branch as previously coded reached into `byKind.get("D6")` and returned amber
 * when absent — a healthy starter would have rendered amber.
 */
export const STARTER_AXIS: LadderAxis = {
  gateKinds: [],
  gateGapBreaks: false,
  ladderKinds: ["S1", "S2", "S3"],
  softTop: null,
  ceilingIsComplete: true,
};

/**
 * Map a rung's CONTRIBUTION to the `d6Effective` badge status (§4d): the D6
 * badge/stat MUST reflect the classified contribution, NOT the raw folded row
 * color. A genuine `FAIL_FRESH` D6 surfaces red; a stale/first-strike D6 is
 * amber; and — the coherence fix — an `INFRA_RED_FRESH` (or NO_DATA/ABSENT) D6
 * is `null` (it folds to gray/no-data in the chip via `severityKind`, so it
 * must NOT surface as a product-red badge either). Equivalent to
 * `contributionToColor` with gray collapsed to `null`.
 */
function contributionToD6Status(
  c: RungContribution["contribution"],
): TestStatus {
  const color = contributionToColor(c);
  return color === "gray" ? null : color;
}

/**
 * Combine the ordered ladder contributions of a cell into the final ladder
 * outputs, on the axis the caller names.
 *
 * `contributions` is depth-ordered and contains ONLY the rungs that
 * structurally exist for this cell: agent = `[D1, D2, D3, D4]` (+ `[D5, D6]`
 * when the feature has a D5 mapping); null-feature = `[D1, D2]`; starter =
 * `[S1, S2, S3]` (always all three — `collectStarterLadder` emits one
 * contribution per declared kind, so a rung with no rows arrives as an explicit
 * `ABSENT` rather than being silently skipped by `scanWorst`).
 *
 * `structuralCeiling` is the `computeMaxPossible` value (§4b): 2 for a
 * null-feature cell, 4 for a D5-unmapped feature, 6 for a D5-mapped feature,
 * `STARTER_CEILING` for a starter cell.
 *
 * `_now` is retained (unused) so every existing call site keeps its positional
 * meaning; `axis` is appended FOURTH, which makes a missed call site a
 * missing-argument type error rather than a silently mis-bound object.
 */
export function combine(
  contributions: RungContribution[],
  structuralCeiling: LadderDepth,
  _now: number,
  axis: LadderAxis,
): CombineResult {
  const byKind = new Map<RungKind, RungContribution>();
  for (const c of contributions) byKind.set(c.kind, c);

  // ── achievedDepth walk + the stopping rung (§4b, §F) ──────────────
  let achieved: LadderDepth = 0;
  let stopRung: RungContribution | null = null;
  for (const c of contributions) {
    if (c.contribution === "GREEN_FRESH") {
      achieved = DEPTH_OF[c.kind];
      continue;
    }
    if (axis.gateKinds.includes(c.kind)) {
      // §F: only a PRESENT fresh-red liveness rung gates; absent/stale/no-data
      // D1/D2 are non-gating and neither stop the walk nor advance achieved.
      if (c.contribution === "FAIL_FRESH") {
        achieved = 0;
        stopRung = c;
        break;
      }
      // On the AGENT axis a non-gating D1/D2 is skipped: the D3+ ladder
      // establishes achieved (a green e2e over an absent health still reads
      // achieved 3). But on the LIVENESS axis the D1/D2 rungs ARE the ladder
      // — there is no higher rung to establish contiguity — so an ABSENT/STUB
      // gate breaks the contiguous-green prefix exactly as the chip's gap rule
      // does (`computeChip`'s `scanWorst`). Without this, a green D2 over an
      // absent D1 would credit achieved==ceiling while the chip is gray
      // (no-data) — the two outputs would contradict. `gateGapBreaks` is the
      // axis input that states which of the two this is.
      if (
        axis.gateGapBreaks &&
        (c.contribution === "ABSENT" || c.contribution === "STUB")
      ) {
        stopRung = c;
        break;
      }
      continue;
    }
    // Ordinary (non-gate) rungs: any non-GREEN_FRESH contribution stops
    // contiguity. On the starter axis EVERY rung takes this branch.
    stopRung = c;
    break;
  }

  // ── chipColor (§4c) ────────────────────────────────────────────────
  const chipColor = computeChip(byKind, structuralCeiling, axis);

  // ── d6Effective (§4d): D6 CONTRIBUTION color, gated by a green ladder
  //    through D5. Derived from the same classified contribution the chip and
  //    isRegression read — NOT the raw folded row status — so an infra-only red
  //    D6 (folded to gray in the chip) does not surface as a product-red badge.
  const tc = axis.softTop ? byKind.get(axis.softTop.kind) : undefined;
  const d6Effective: TestStatus =
    axis.softTop && achieved >= axis.softTop.atCeiling - 1 && tc
      ? contributionToD6Status(tc.contribution)
      : null;

  // ── isRegression (§4d): stopping rung above achieved is a GENUINE fail ──
  const isRegression =
    structuralCeiling > 0 &&
    achieved < structuralCeiling &&
    stopRung !== null &&
    stopRung.contribution === "FAIL_FRESH";

  return {
    chipColor,
    achievedDepth: achieved,
    ceilingDepth: structuralCeiling,
    d6Effective,
    isRegression,
  };
}

/**
 * Chip color by scanning the ladder (§4c), on the caller's axis.
 *
 * Step 1 is the §F gate: a PRESENT fresh-red rung among `axis.gateKinds`
 * dominates → red. An axis with no gate rungs (starter) skips it entirely.
 *
 * Step 2 is one worst-wins scan over `axis.ladderKinds` — the axis's COMPLETE
 * rung set, never truncated. The all-green branch then splits two questions the
 * previous code conflated: "is an all-green ladder at this ceiling complete?"
 * (`ceilingIsComplete`) and "apply the soft-parity top" (`softTop`). They are
 * independent inputs because a single boolean cannot express the starter axis.
 */
function computeChip(
  byKind: Map<RungKind, RungContribution>,
  ceiling: LadderDepth,
  axis: LadderAxis,
): ChipColor {
  // Step 1 — §F liveness gate: a present fresh-red gate rung dominates → red.
  for (const k of axis.gateKinds) {
    const c = byKind.get(k);
    if (c && c.contribution === "FAIL_FRESH") return "red";
  }

  // Step 2 — worst-wins over the axis's complete ladder, with the gap-break.
  const { worst, gap } = scanWorst(byKind, axis.ladderKinds);

  if (!gap && worst === "GREEN_FRESH") {
    if (axis.softTop && ceiling === axis.softTop.atCeiling) {
      // Soft-parity top: any non-green top rung over a green ladder → amber.
      const t = byKind.get(axis.softTop.kind);
      return t && t.contribution === "GREEN_FRESH" ? "green" : "amber";
    }
    // Agent axis at ceiling 4 (D5 unmapped): a D4 ceiling is NOT a complete
    // verification level (A3) — green requires a real top rung → gray.
    return axis.ceilingIsComplete ? "green" : "gray";
  }

  return contributionToColor(worst);
}

/**
 * Fold the given rung kinds worst-wins (§4a severity). The FIRST ABSENT/STUB
 * rung is included as ABSENT and STOPS the walk (a gap grays the cell — rungs
 * above the gap are not contiguous, I1). INFRA_RED_FRESH re-maps to NO_DATA
 * severity inside `worseOf`. Returns the worst contribution seen and whether a
 * gap stopped the walk.
 */
function scanWorst(
  byKind: Map<RungKind, RungContribution>,
  kinds: readonly RungKind[],
): { worst: RungContribution["contribution"]; gap: boolean } {
  let worst: RungContribution["contribution"] = "GREEN_FRESH";
  let gap = false;
  for (const k of kinds) {
    const c = byKind.get(k);
    // Structurally beyond the ceiling (e.g. D5 unmapped) — NOT a gap.
    // This `continue` is why a DECLARED rung that never reaches the fold would
    // render green: `scanWorst` cannot tell "beyond the ceiling" from "the
    // collector dropped it". The collector therefore emits one contribution per
    // declared kind (an explicit `ABSENT` when it has no rows), and
    // `ladder-rung-completeness.test.ts` asserts that it did.
    if (!c) continue;
    if (c.contribution === "ABSENT" || c.contribution === "STUB") {
      worst = worseOf(worst, "ABSENT");
      gap = true;
      break;
    }
    worst = worseOf(worst, c.contribution);
  }
  return { worst, gap };
}
