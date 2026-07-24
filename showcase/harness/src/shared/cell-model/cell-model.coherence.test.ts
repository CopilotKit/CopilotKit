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
 *  - INV7  chip==gray ∧ some depth pill reads red ⟹ EVERY contributing red row
 *          carries POSITIVE infra evidence                        (fail-safe
 *          polarity — see below)
 *
 * INV7 is the invariant whose ABSENCE let a long-lived misreport ship. INV1–INV6
 * only relate `chipColor` to the other CHIP-side outputs; none of them inspects
 * the `d3`/`d4`/`d5`/`d6` `TestLevel`s (the depth pill strip), which are read
 * straight off the RAW fold and never consult the infra classifier. So the
 * engine could — and did — return one model object that simultaneously said
 * `d5.status === "red"` (strip renders `1P ✗`) and `chipColor === "gray"` (chip
 * renders the muted "no live data" treatment), and every chip-side invariant
 * still held. Roughly 20% of the matrix rendered that way on every cold load.
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
import type { CellModel } from "./cell-model.js";
import type { LiveStatusMap } from "./live-status.js";
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
 * INV7 — CHIP/STRIP coherence with the fail-safe polarity. Needs the input rows
 * (not just the model) because the legitimate gray-over-a-red case is defined by
 * POSITIVE infra evidence in the rows' `signal` blobs.
 *
 * A gray chip means "no live verdict to show". It is only honest above a red
 * depth pill when every contributing red row actually SAYS the failure was
 * infra. A red row with a stripped `signal` says nothing at all — that is a
 * PENDING attribution, and must surface as red/amber, not gray.
 */
function assertChipStripCoherent(
  label: string,
  m: CellModel,
  live: LiveStatusMap,
): void {
  // A pill can be null entirely (an unsupported column has no strip at all).
  const stripReadsRed = [m.d3, m.d4, m.d5, m.d6].some(
    (lvl) => lvl !== null && lvl.exists && lvl.status === "red",
  );
  if (m.chipColor !== "gray" || !stripReadsRed) return;
  const redRows = [...live.values()].filter(
    (r) => rankOfState(r.state) >= RED_RANK,
  );
  for (const r of redRows) {
    expect(
      signalHasInfraErrorClass(r.signal),
      `${label}: INV7 gray chip over a red pill requires POSITIVE infra ` +
        `evidence on every red row — ${r.key} has none (signal ${
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
      assertChipStripCoherent(f.name, m, f.live);
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
    freshestAgeMs: 0,
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
