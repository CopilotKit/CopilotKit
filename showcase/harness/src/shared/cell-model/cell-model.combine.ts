/**
 * The uniform combination fold — Stage C of the unified cell-model pipeline
 * (spec §4). ONE walk over ONE ordered `RungContribution[]` yields EVERY ladder
 * output: `chipColor`, `achievedDepth`, `ceilingDepth`, `d6Effective`, and
 * `isRegression`. No output field is derived by its own predicate chain
 * (guarantee §2a-1), and the D1/D2 liveness gate is applied asymmetrically per
 * §F (absent/stale D1/D2 non-gating; only a present fresh-red D1/D2 gates).
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
  starter: 0,
};

function isGate(kind: RungKind): boolean {
  return kind === "D1" || kind === "D2";
}

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
 * Combine the ordered ladder contributions of a NON-starter cell (agent axis,
 * or a null-feature liveness-only cell) into the final ladder outputs.
 *
 * `contributions` is depth-ordered and contains ONLY the rungs that
 * structurally exist for this cell: agent = `[D1, D2, D3, D4]` (+ `[D5, D6]`
 * when the feature has a D5 mapping); null-feature = `[D1, D2]`.
 * `structuralCeiling` is the `computeMaxPossible` value (§4b): 2 for a
 * null-feature cell, 4 for a D5-unmapped feature, 6 for a D5-mapped feature.
 */
export function combine(
  contributions: RungContribution[],
  structuralCeiling: LadderDepth,
  _now: number,
): CombineResult {
  const byKind = new Map<RungKind, RungContribution>();
  for (const c of contributions) byKind.set(c.kind, c);
  const isNullFeature = !byKind.has("D3");

  // ── achievedDepth walk + the stopping rung (§4b, §F) ──────────────
  let achieved: LadderDepth = 0;
  let stopRung: RungContribution | null = null;
  for (const c of contributions) {
    if (c.contribution === "GREEN_FRESH") {
      achieved = DEPTH_OF[c.kind];
      continue;
    }
    if (isGate(c.kind)) {
      // §F: only a PRESENT fresh-red liveness rung gates; absent/stale/no-data
      // D1/D2 are non-gating and neither stop the walk nor advance achieved.
      if (c.contribution === "FAIL_FRESH") {
        achieved = 0;
        stopRung = c;
        break;
      }
      // On the AGENT axis a non-gating D1/D2 is skipped: the D3+ ladder
      // establishes achieved (a green e2e over an absent health still reads
      // achieved 3). But for a NULL-FEATURE cell the D1/D2 rungs ARE the ladder
      // — there is no higher rung to establish contiguity — so an ABSENT/STUB
      // gate breaks the contiguous-green prefix exactly as the chip's gap rule
      // does (`computeChip` null-feature `scanWorst`). Without this, a green D2
      // over an absent D1 would credit achieved==ceiling while the chip is gray
      // (no-data) — the two outputs would contradict.
      if (
        isNullFeature &&
        (c.contribution === "ABSENT" || c.contribution === "STUB")
      ) {
        stopRung = c;
        break;
      }
      continue;
    }
    // D3–D6: any non-GREEN_FRESH contribution stops contiguity.
    stopRung = c;
    break;
  }

  // ── chipColor (§4c) ────────────────────────────────────────────────
  const chipColor = computeChip(byKind, structuralCeiling, isNullFeature);

  // ── d6Effective (§4d): D6 CONTRIBUTION color, gated by a green ladder
  //    through D5. Derived from the same classified contribution the chip and
  //    isRegression read — NOT the raw folded row status — so an infra-only red
  //    D6 (folded to gray in the chip) does not surface as a product-red badge.
  const d6c = byKind.get("D6");
  const d6Effective: TestStatus =
    achieved >= 5 && d6c ? contributionToD6Status(d6c.contribution) : null;

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
 * Chip color by scanning the ladder (§4c). D1/D2 are gate-only for an agent
 * cell (a present fresh-red gates to red; absent/stale are non-gating and do
 * not colour the chip); the null-feature cell's ladder IS D1/D2.
 */
function computeChip(
  byKind: Map<RungKind, RungContribution>,
  ceiling: LadderDepth,
  isNullFeature: boolean,
): ChipColor {
  // Step 1 — §F liveness gate: a present fresh-red D1/D2 dominates → red.
  for (const k of ["D1", "D2"] as const) {
    const c = byKind.get(k);
    if (c && c.contribution === "FAIL_FRESH") return "red";
  }

  // Null-feature: the ladder ends at D2 (liveness only). Worst-wins over
  // D1/D2 with the absent-grays-a-gap rule; both green → green (complete).
  if (isNullFeature) {
    return scanColor(byKind, ["D1", "D2"], /*completeCeiling*/ true);
  }

  // Agent cell: worst-wins over the lower ladder D3→D5 with a gap-break, then
  // the D6 soft-parity top exception.
  const lowerKinds: RungKind[] = ["D3", "D4", "D5"];
  const { worst, gap } = scanWorst(byKind, lowerKinds);

  if (!gap && worst === "GREEN_FRESH") {
    // Ladder is GREEN_FRESH through its lower rungs.
    if (ceiling === 6) {
      // D6 soft-parity top: any non-green D6 over a green D1–D5 → amber.
      const d6 = byKind.get("D6");
      return d6 && d6.contribution === "GREEN_FRESH" ? "green" : "amber";
    }
    // ceiling 4 (D5 unmapped): a D4 ceiling is NOT a complete verification
    // level (A3) — green requires a real top rung → gray.
    return "gray";
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
  kinds: RungKind[],
): { worst: RungContribution["contribution"]; gap: boolean } {
  let worst: RungContribution["contribution"] = "GREEN_FRESH";
  let gap = false;
  for (const k of kinds) {
    const c = byKind.get(k);
    if (!c) continue; // structurally beyond the ceiling (e.g. D5 unmapped)
    if (c.contribution === "ABSENT" || c.contribution === "STUB") {
      worst = worseOf(worst, "ABSENT");
      gap = true;
      break;
    }
    worst = worseOf(worst, c.contribution);
  }
  return { worst, gap };
}

/** scanWorst → color, with an all-green ceiling that is genuinely complete. */
function scanColor(
  byKind: Map<RungKind, RungContribution>,
  kinds: RungKind[],
  _completeCeiling: boolean,
): ChipColor {
  const { worst } = scanWorst(byKind, kinds);
  return contributionToColor(worst);
}
