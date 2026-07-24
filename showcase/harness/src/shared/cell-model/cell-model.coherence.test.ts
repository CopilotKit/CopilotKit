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
 */
import { describe, it, expect } from "vitest";
import { buildCellModel } from "./cell-model.js";
import { combine } from "./cell-model.combine.js";
import type {
  RungContribution,
  RungKind,
  ContributionKind,
} from "./cell-model.contribution.js";
import type { CellModel } from "./cell-model.js";
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

describe("cell-model coherence — cross-field invariants over the fixture matrix", () => {
  for (const f of FIXTURES) {
    it(`coheres for fixture: ${f.name}`, () => {
      assertCoherent(f.name, buildCellModel(f.live, f.input, NOW));
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
