import { describe, it, expect } from "vitest";
import { combine } from "./cell-model.combine.js";
import type { LadderDepth } from "./cell-model.combine.js";
import type {
  ContributionKind,
  RungContribution,
  RungKind,
} from "./cell-model.contribution.js";
import type { TestStatus } from "./cell-model.js";

const NOW = 0;

// Mirror `classifyRung`'s real `rawStatus` (the RAW folded row color, before
// the contribution's display de-amplification): a red fold — genuine, infra,
// OR first-strike — carries `rawStatus: "red"`; a stale/degraded fold carries
// "amber"; green carries "green"; and the no-row / no-data classes carry null.
// (A first-strike DISPLAYS amber but its raw fold is red — the amber lives in
// the contribution kind, not in rawStatus.)
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

function c(kind: RungKind, contribution: ContributionKind): RungContribution {
  return {
    kind,
    contribution,
    rawStatus: rawStatusOf(contribution),
    freshestAgeMs: 0,
  };
}

/** Agent ladder [D1,D2,D3,D4,D5,D6] with GREEN_FRESH defaults + overrides. */
function agent(
  over: Partial<Record<RungKind, ContributionKind>> = {},
  opts: { ceiling?: LadderDepth; upTo?: RungKind } = {},
): { contribs: RungContribution[]; ceiling: LadderDepth } {
  const ceiling = opts.ceiling ?? 6;
  const kinds: RungKind[] =
    ceiling === 6
      ? ["D1", "D2", "D3", "D4", "D5", "D6"]
      : ["D1", "D2", "D3", "D4"];
  const contribs = kinds.map((k) => c(k, over[k] ?? "GREEN_FRESH"));
  return { contribs, ceiling };
}

describe("combine — §4f agent truth table", () => {
  it("all green → green, ach6, ceil6, d6Eff green, no reg", () => {
    const { contribs, ceiling } = agent();
    expect(combine(contribs, ceiling, NOW)).toEqual({
      chipColor: "green",
      achievedDepth: 6,
      ceilingDepth: 6,
      d6Effective: "green",
      isRegression: false,
    });
  });

  it("D6 fresh-red over green D5 → amber, ach5, d6Eff red, reg yes (soft-parity top)", () => {
    const { contribs, ceiling } = agent({ D6: "FAIL_FRESH" });
    expect(combine(contribs, ceiling, NOW)).toEqual({
      chipColor: "amber",
      achievedDepth: 5,
      ceilingDepth: 6,
      d6Effective: "red",
      isRegression: true,
    });
  });

  it("D6 stale over green D5 → amber, ach5, no reg (soft-parity, grounded item 1)", () => {
    const { contribs, ceiling } = agent({ D6: "STALE_DEGRADED" });
    const r = combine(contribs, ceiling, NOW);
    expect(r.chipColor).toBe("amber");
    expect(r.achievedDepth).toBe(5);
    expect(r.d6Effective).toBe("amber");
    expect(r.isRegression).toBe(false);
  });

  it("D6 absent over green D5 → amber, ach5, d6Eff null, no reg (soft-parity)", () => {
    const { contribs, ceiling } = agent({ D6: "ABSENT" });
    const r = combine(contribs, ceiling, NOW);
    expect(r.chipColor).toBe("amber");
    expect(r.achievedDepth).toBe(5);
    expect(r.d6Effective).toBeNull();
    expect(r.isRegression).toBe(false);
  });

  it("D5 fresh-red → red, ach4, d6Eff null, reg yes", () => {
    const { contribs, ceiling } = agent({ D5: "FAIL_FRESH", D6: "ABSENT" });
    expect(combine(contribs, ceiling, NOW)).toEqual({
      chipColor: "red",
      achievedDepth: 4,
      ceilingDepth: 6,
      d6Effective: null,
      isRegression: true,
    });
  });

  it("D5 stale → amber, ach4, no reg (I2)", () => {
    const { contribs, ceiling } = agent({ D5: "STALE_DEGRADED", D6: "ABSENT" });
    const r = combine(contribs, ceiling, NOW);
    expect(r.chipColor).toBe("amber");
    expect(r.achievedDepth).toBe(4);
    expect(r.isRegression).toBe(false);
  });

  it("D4 first-strike → amber, ach3, no reg (D4 de-amp item 6)", () => {
    const { contribs, ceiling } = agent({
      D4: "FIRST_STRIKE_FRESH",
      D5: "ABSENT",
      D6: "ABSENT",
    });
    const r = combine(contribs, ceiling, NOW);
    expect(r.chipColor).toBe("amber");
    expect(r.achievedDepth).toBe(3);
    expect(r.isRegression).toBe(false);
  });

  it("stale D3 + fresh-red D5 → red, ach2, no reg (I3/A2)", () => {
    const { contribs, ceiling } = agent({
      D3: "STALE_DEGRADED",
      D5: "FAIL_FRESH",
      D6: "ABSENT",
    });
    const r = combine(contribs, ceiling, NOW);
    expect(r.chipColor).toBe("red");
    expect(r.achievedDepth).toBe(2);
    expect(r.isRegression).toBe(false);
  });

  it("D3 absent, green above → gray, ach2, no reg (I1)", () => {
    const { contribs, ceiling } = agent({ D3: "ABSENT" });
    const r = combine(contribs, ceiling, NOW);
    expect(r.chipColor).toBe("gray");
    expect(r.achievedDepth).toBe(2);
    expect(r.isRegression).toBe(false);
  });

  it("D4 absent (single), green above → gray, ach3, no reg (I1 symmetric)", () => {
    const { contribs, ceiling } = agent({ D4: "ABSENT" });
    const r = combine(contribs, ceiling, NOW);
    expect(r.chipColor).toBe("gray");
    expect(r.achievedDepth).toBe(3);
    expect(r.isRegression).toBe(false);
  });

  it("D5 unmapped (ceiling 4), green D3/D4 → gray, ach4, ceil4, no reg (A3)", () => {
    const { contribs, ceiling } = agent({}, { ceiling: 4 });
    expect(combine(contribs, ceiling, NOW)).toEqual({
      chipColor: "gray",
      achievedDepth: 4,
      ceilingDepth: 4,
      d6Effective: null,
      isRegression: false,
    });
  });

  it("infra-red D3, green above → gray, ach2, no reg (U7 + I4)", () => {
    const { contribs, ceiling } = agent({ D3: "INFRA_RED_FRESH" });
    const r = combine(contribs, ceiling, NOW);
    expect(r.chipColor).toBe("gray");
    expect(r.achievedDepth).toBe(2);
    expect(r.isRegression).toBe(false);
  });
});

describe("combine — §F D1/D2 liveness gate", () => {
  it("absent D1/D2 over green D3–D6 → green, ach6, no reg (non-gating, item 7)", () => {
    const contribs = [
      c("D1", "ABSENT"),
      c("D2", "ABSENT"),
      c("D3", "GREEN_FRESH"),
      c("D4", "GREEN_FRESH"),
      c("D5", "GREEN_FRESH"),
      c("D6", "GREEN_FRESH"),
    ];
    expect(combine(contribs, 6, NOW)).toEqual({
      chipColor: "green",
      achievedDepth: 6,
      ceilingDepth: 6,
      d6Effective: "green",
      isRegression: false,
    });
  });

  it("stale D1/D2 over green D3–D6 → green (non-gating)", () => {
    const contribs = [
      c("D1", "STALE_DEGRADED"),
      c("D2", "STALE_DEGRADED"),
      c("D3", "GREEN_FRESH"),
      c("D4", "GREEN_FRESH"),
      c("D5", "GREEN_FRESH"),
      c("D6", "GREEN_FRESH"),
    ];
    const r = combine(contribs, 6, NOW);
    expect(r.chipColor).toBe("green");
    expect(r.achievedDepth).toBe(6);
  });

  it("present fresh-red D1 → red, ach0, reg yes (gates)", () => {
    const contribs = [
      c("D1", "FAIL_FRESH"),
      c("D2", "GREEN_FRESH"),
      c("D3", "GREEN_FRESH"),
      c("D4", "GREEN_FRESH"),
      c("D5", "GREEN_FRESH"),
      c("D6", "GREEN_FRESH"),
    ];
    expect(combine(contribs, 6, NOW)).toEqual({
      chipColor: "red",
      achievedDepth: 0,
      ceilingDepth: 6,
      d6Effective: null,
      isRegression: true,
    });
  });
});

describe("combine — null-feature liveness-only cell", () => {
  it("green D1+D2 → green, ach2, ceil2, no reg", () => {
    const contribs = [c("D1", "GREEN_FRESH"), c("D2", "GREEN_FRESH")];
    expect(combine(contribs, 2, NOW)).toEqual({
      chipColor: "green",
      achievedDepth: 2,
      ceilingDepth: 2,
      d6Effective: null,
      isRegression: false,
    });
  });

  it("fresh-red D2 gates → red, ach0, reg yes (§F: present fresh-red liveness gates to 0)", () => {
    const contribs = [c("D1", "GREEN_FRESH"), c("D2", "FAIL_FRESH")];
    const r = combine(contribs, 2, NOW);
    expect(r.chipColor).toBe("red");
    expect(r.achievedDepth).toBe(0);
    expect(r.isRegression).toBe(true);
  });
});
