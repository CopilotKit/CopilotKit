import { describe, it, expect } from "vitest";
import type { StatusRow, State } from "./live-status.js";
import {
  CHIP_SEVERITY,
  worseOf,
  severityIndex,
  contributionToColor,
  firstStrikeConfig,
  D4_FIRST_STRIKE_THRESHOLD,
  classifyRung,
  type RawRung,
  type RungKind,
  type ContributionKind,
} from "./cell-model.contribution.js";
import { E2E_STALE_AFTER_MS, FUTURE_SKEW_TOLERANCE_MS } from "./staleness.js";

const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const FRESH = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - E2E_STALE_AFTER_MS - 60_000).toISOString();
const FUTURE = new Date(NOW + FUTURE_SKEW_TOLERANCE_MS + 60_000).toISOString();
// A future-dated row WITHIN the skew tolerance (not skewed) — models sub-5m
// fleet clock drift. `now - observed_at` is negative for this row.
const NEAR_FUTURE = new Date(NOW + 60_000).toISOString();

function row(
  state: State,
  opts: { observedAt?: string; signal?: unknown; failCount?: number } = {},
): StatusRow {
  const observed = opts.observedAt ?? FRESH;
  return {
    id: "id",
    key: "k",
    dimension: "d",
    state,
    signal: "signal" in opts ? opts.signal : null,
    observed_at: observed,
    transitioned_at: observed,
    fail_count: opts.failCount ?? (state === "red" ? 1 : 0),
    first_failure_at: state === "red" ? observed : null,
  };
}

function raw(
  kind: RungKind,
  rows: StatusRow[],
  opts: Partial<RawRung> = {},
): RawRung {
  return {
    kind,
    rows,
    mapped: opts.mapped ?? true,
    anyExpectedMissing: opts.anyExpectedMissing ?? false,
    signalKnown: opts.signalKnown ?? true,
  };
}

describe("contribution lattices + config", () => {
  it("orders chip severity FAIL > STALE > FIRST_STRIKE > NO_DATA > ABSENT > GREEN", () => {
    expect(CHIP_SEVERITY).toEqual([
      "FAIL_FRESH",
      "STALE_DEGRADED",
      "FIRST_STRIKE_FRESH",
      "NO_DATA",
      "ABSENT",
      "GREEN_FRESH",
    ]);
    expect(severityIndex("FAIL_FRESH")).toBeLessThan(
      severityIndex("STALE_DEGRADED"),
    );
    expect(severityIndex("STALE_DEGRADED")).toBeLessThan(
      severityIndex("FIRST_STRIKE_FRESH"),
    );
    expect(severityIndex("FIRST_STRIKE_FRESH")).toBeLessThan(
      severityIndex("NO_DATA"),
    );
    expect(severityIndex("NO_DATA")).toBeLessThan(severityIndex("ABSENT"));
    expect(severityIndex("ABSENT")).toBeLessThan(severityIndex("GREEN_FRESH"));
  });

  it("re-maps INFRA_RED_FRESH to NO_DATA severity", () => {
    expect(severityIndex("INFRA_RED_FRESH")).toBe(severityIndex("NO_DATA"));
    expect(contributionToColor("INFRA_RED_FRESH")).toBe("gray");
  });

  it("worseOf picks the more severe", () => {
    expect(worseOf("GREEN_FRESH", "FAIL_FRESH")).toBe("FAIL_FRESH");
    expect(worseOf("ABSENT", "NO_DATA")).toBe("NO_DATA");
    expect(worseOf("STALE_DEGRADED", "FIRST_STRIKE_FRESH")).toBe(
      "STALE_DEGRADED",
    );
  });

  it("severityIndex is defined (>= 0) for EVERY kind — no kind sorts worst-but-gray (fail-safe polarity)", () => {
    const ALL: ContributionKind[] = [
      "UNSUPPORTED",
      "STUB",
      "ABSENT",
      "NO_DATA",
      "GREEN_FRESH",
      "STALE_DEGRADED",
      "FIRST_STRIKE_FRESH",
      "INFRA_RED_FRESH",
      "FAIL_FRESH",
    ];
    for (const k of ALL) {
      // Never -1: an unrecognized kind must not sort as the WORST in a fold
      // and then render gray (masking a real red). `severityKind` is exhaustive.
      expect(severityIndex(k)).toBeGreaterThanOrEqual(0);
      // A genuine FAIL_FRESH (red) must always win a fold over any non-red kind.
      if (contributionToColor(k) !== "red") {
        expect(worseOf("FAIL_FRESH", k)).toBe("FAIL_FRESH");
      }
    }
  });

  it("maps contribution → color", () => {
    expect(contributionToColor("FAIL_FRESH")).toBe("red");
    expect(contributionToColor("STALE_DEGRADED")).toBe("amber");
    expect(contributionToColor("FIRST_STRIKE_FRESH")).toBe("amber");
    expect(contributionToColor("NO_DATA")).toBe("gray");
    expect(contributionToColor("ABSENT")).toBe("gray");
    expect(contributionToColor("GREEN_FRESH")).toBe("green");
  });

  it("first-strike config: starter soft/2, D4 any/2, D3/D5/D6 disabled", () => {
    expect(firstStrikeConfig.starter).toEqual({
      enabled: true,
      threshold: 2,
      requireSoftClass: true,
    });
    expect(firstStrikeConfig.D4).toEqual({
      enabled: true,
      threshold: D4_FIRST_STRIKE_THRESHOLD,
      requireSoftClass: false,
    });
    for (const k of ["D1", "D2", "D3", "D5", "D6"] as const) {
      expect(firstStrikeConfig[k].enabled).toBe(false);
    }
  });
});

describe("classifyRung — §3 rules", () => {
  it("empty rows → ABSENT", () => {
    expect(classifyRung(raw("D3", []), NOW).contribution).toBe("ABSENT");
  });

  it("fresh green → GREEN_FRESH", () => {
    expect(classifyRung(raw("D3", [row("green")]), NOW).contribution).toBe(
      "GREEN_FRESH",
    );
  });

  it("stale green → STALE_DEGRADED (rule 2)", () => {
    expect(
      classifyRung(raw("D3", [row("green", { observedAt: STALE })]), NOW)
        .contribution,
    ).toBe("STALE_DEGRADED");
  });

  it("native degraded → STALE_DEGRADED (amber tier)", () => {
    expect(classifyRung(raw("D3", [row("degraded")]), NOW).contribution).toBe(
      "STALE_DEGRADED",
    );
  });

  it("fresh red (known non-infra signal) → FAIL_FRESH", () => {
    expect(classifyRung(raw("D3", [row("red")]), NOW).contribution).toBe(
      "FAIL_FRESH",
    );
  });

  it("infra-classed red → INFRA_RED_FRESH (rule 4)", () => {
    expect(
      classifyRung(
        raw("D3", [row("red", { signal: { errorClass: "driver-error" } })]),
        NOW,
      ).contribution,
    ).toBe("INFRA_RED_FRESH");
  });

  it("red with stripped signal → NO_DATA, never product-red (rule 4 / §D)", () => {
    expect(
      classifyRung(
        raw("D3", [row("red", { signal: undefined })], { signalKnown: false }),
        NOW,
      ).contribution,
    ).toBe("NO_DATA");
  });

  it("anyExpectedMissing + green fold → NO_DATA (strict collapse)", () => {
    expect(
      classifyRung(raw("D4", [row("green")], { anyExpectedMissing: true }), NOW)
        .contribution,
    ).toBe("NO_DATA");
  });

  it("anyExpectedMissing but present RED still dominates → FAIL_FRESH", () => {
    expect(
      classifyRung(raw("D5", [row("red")], { anyExpectedMissing: true }), NOW)
        .contribution,
    ).toBe("FAIL_FRESH");
  });

  it("D4 first-strike: fail_count 1 → FIRST_STRIKE_FRESH; 2 → FAIL_FRESH (rule 3)", () => {
    expect(
      classifyRung(raw("D4", [row("red", { failCount: 1 })]), NOW).contribution,
    ).toBe("FIRST_STRIKE_FRESH");
    expect(
      classifyRung(raw("D4", [row("red", { failCount: 2 })]), NOW).contribution,
    ).toBe("FAIL_FRESH");
  });

  it("starter first-strike: soft+fc1 → FIRST_STRIKE; hard → FAIL; soft+fc2 → FAIL", () => {
    const soft1 = row("red", {
      signal: { errorClass: "transport-error" },
      failCount: 1,
    });
    const soft2 = row("red", {
      signal: { errorClass: "transport-error" },
      failCount: 2,
    });
    const hard = row("red", {
      signal: { errorClass: "smoke-failed" },
      failCount: 1,
    });
    expect(classifyRung(raw("starter", [soft1]), NOW).contribution).toBe(
      "FIRST_STRIKE_FRESH",
    );
    expect(classifyRung(raw("starter", [soft2]), NOW).contribution).toBe(
      "FAIL_FRESH",
    );
    expect(classifyRung(raw("starter", [hard]), NOW).contribution).toBe(
      "FAIL_FRESH",
    );
  });

  it("D3 red never first-strikes (config disabled) → FAIL_FRESH", () => {
    expect(
      classifyRung(raw("D3", [row("red", { failCount: 1 })]), NOW).contribution,
    ).toBe("FAIL_FRESH");
  });

  it("future-skewed green → STALE_DEGRADED and excluded from freshestAgeMs (rule 5 / §E)", () => {
    const c = classifyRung(
      raw("D3", [row("green", { observedAt: FUTURE })]),
      NOW,
    );
    expect(c.contribution).toBe("STALE_DEGRADED");
    expect(c.freshestAgeMs).toBeNull();
  });

  it("within-tolerance future-dated row clamps freshestAgeMs to >= 0 (§E, never negative)", () => {
    const c = classifyRung(
      raw("D3", [row("green", { observedAt: NEAR_FUTURE })]),
      NOW,
    );
    // Not skewed (within 5m tolerance) so it IS admitted to the freshest pick,
    // but the negative `now - observed_at` must clamp to 0 rather than surface
    // a negative "in the future" age.
    expect(c.freshestAgeMs).toBe(0);
    expect(c.freshestAgeMs).toBeGreaterThanOrEqual(0);
  });

  it("family fold: one stale-green sibling forces STALE_DEGRADED (worst-wins)", () => {
    const c = classifyRung(
      raw("D4", [row("green"), row("green", { observedAt: STALE })]),
      NOW,
    );
    expect(c.contribution).toBe("STALE_DEGRADED");
  });

  it("family fold: a fresh red beats a stale-green sibling → FAIL_FRESH (D3, no first-strike)", () => {
    const c = classifyRung(
      raw("D3", [row("green", { observedAt: STALE }), row("red")]),
      NOW,
    );
    expect(c.contribution).toBe("FAIL_FRESH");
  });

  // ── First-strike de-amplification must gate on the WORST non-infra red ──
  // (round-4 finding A). A sustained non-infra red must NEVER be masked to
  // amber by a lower-count sibling — whether that sibling is another first-
  // strike red or an infra-classed red. The gate is MAX over NON-INFRA reds.

  it("D4 fold: sustained non-infra red (fc3) + first-strike non-infra sibling (fc1) → FAIL_FRESH, not masked to amber", () => {
    // chat sustained (fc3) + tools first-strike (fc1), both non-infra red.
    // MIN gate (old, buggy) → min(3,1)=1 < 2 → FIRST_STRIKE_FRESH (amber).
    // MAX-over-non-infra gate (correct) → max(3,1)=3 >= 2 → FAIL_FRESH (red).
    const c = classifyRung(
      raw("D4", [row("red", { failCount: 3 }), row("red", { failCount: 1 })]),
      NOW,
    );
    expect(c.contribution).toBe("FAIL_FRESH");
    expect(contributionToColor(c.contribution)).toBe("red");
  });

  it("D4 fold: sustained non-infra red (fc3) + first-strike INFRA red (fc1) → FAIL_FRESH, infra red excluded from first-strike gate", () => {
    // chat sustained non-infra (fc3) + an infra driver-error red on its first
    // strike (fc1). Old code folds the infra red's fc into the MIN → amber.
    // Correct: infra reds are excluded from the gate → worst non-infra = 3 → red.
    const c = classifyRung(
      raw("D4", [
        row("red", { failCount: 3 }),
        row("red", { signal: { errorClass: "driver-error" }, failCount: 1 }),
      ]),
      NOW,
    );
    expect(c.contribution).toBe("FAIL_FRESH");
    expect(contributionToColor(c.contribution)).toBe("red");
  });

  it("D4 fold: EVERY non-infra red still a first strike (fc1 + fc1) → FIRST_STRIKE_FRESH preserved", () => {
    // Guards against over-correction: de-amplification must still apply when
    // the worst non-infra red is itself below threshold.
    const c = classifyRung(
      raw("D4", [row("red", { failCount: 1 }), row("red", { failCount: 1 })]),
      NOW,
    );
    expect(c.contribution).toBe("FIRST_STRIKE_FRESH");
    expect(contributionToColor(c.contribution)).toBe("amber");
  });

  it("starter fold: sustained soft red (fc5) + first-strike soft sibling (fc1) → FAIL_FRESH, not masked to amber", () => {
    // Both soft (transport-error) so requireSoftClass is satisfied; the MIN
    // gate would tolerate the fc5 confirmed miss because of the fc1 sibling.
    const soft5 = row("red", {
      signal: { errorClass: "transport-error" },
      failCount: 5,
    });
    const soft1 = row("red", {
      signal: { errorClass: "transport-error" },
      failCount: 1,
    });
    const c = classifyRung(raw("starter", [soft5, soft1]), NOW);
    expect(c.contribution).toBe("FAIL_FRESH");
    expect(contributionToColor(c.contribution)).toBe("red");
  });
});
