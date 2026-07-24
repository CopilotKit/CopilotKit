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
 *  - INV7  chip==gray ∧ !isStaleCell ∧ some depth pill reads red ⟹ EVERY red row
 *          THIS CELL contributes from carries POSITIVE infra evidence
 *                                                                 (fail-safe
 *          polarity — see below; the `isStaleCell` carve-out and the
 *          per-cell quantification are both load-bearing, see
 *          `assertChipStripCoherent`)
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
 * `CATALOG_TO_D5_KEY` (or the four `starter:<column>/<level>` rows on the
 * starter axis, whose cells carry no depth strip at all).
 *
 * INV7 quantifies over exactly these rows. `live` is a WHOLE-MATRIX map, so a
 * red row in it may belong to a completely different column or feature; such a
 * row contributes nothing to this cell's chip and therefore says nothing about
 * whether this cell's gray chip is honest. Reading it would make INV7 fail on
 * unrelated map contents.
 */
function contributingKeys(input: CellModelInput): string[] {
  if (input.probeAxis === "starter") {
    return (STARTER_LEVELS as readonly StarterLevel[]).map((level) =>
      keyFor("starter", input.slug, level),
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
 * INV7 — CHIP/STRIP coherence with the fail-safe polarity. Needs the input rows
 * and the cell's `input` (not just the model) because the legitimate
 * gray-over-a-red case is defined by POSITIVE infra evidence in the rows'
 * `signal` blobs, and only THIS cell's rows can supply it.
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
  input: CellModelInput,
): void {
  // A pill can be null entirely (an unsupported column has no strip at all).
  const stripReadsRed = [m.d3, m.d4, m.d5, m.d6].some(
    (lvl) => lvl !== null && lvl.exists && lvl.status === "red",
  );
  if (m.chipColor !== "gray" || !stripReadsRed) return;

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

  // ── Teeth: INV7 must still FAIL a genuine gray-over-red incoherence. The
  //    engine no longer produces one (that is the PR's fix), so the chip is
  //    perturbed to gray on an otherwise-real model — exactly the regression
  //    INV7 exists to catch.
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
});
