/**
 * §7 spec-conformance for the unified engine, exercised against the REAL engine
 * surface with seeded `LiveStatusMap`s. Each test asserts `buildCellModel`
 * produces the NEW (spec) value for a §7 scenario.
 *
 * The pre-change (RED) values for these §7 scenarios were gated during the swap
 * by a since-retired diff-allowlist; the golden master
 * (`cell-model.equivalence-baseline.json`) is now re-frozen to the unified
 * engine's (GREEN) output. This file pins that GREEN behavior directly on the
 * live engine; it also covers the NEW null-feature path (T4).
 */
import { describe, it, expect } from "vitest";
import type { StatusRow, State } from "./live-status.js";
import { keyFor, mergeRowsToMap, CATALOG_TO_D5_KEY } from "./live-status.js";
import { buildCellModel, type CellModelInput } from "./cell-model.js";
import { E2E_STALE_AFTER_MS, FUTURE_SKEW_TOLERANCE_MS } from "./staleness.js";

const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const FRESH = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - E2E_STALE_AFTER_MS - 60_000).toISOString();
const FUTURE = new Date(NOW + FUTURE_SKEW_TOLERANCE_MS + 60_000).toISOString();
const SLUG = "acme";
const F = "agentic-chat"; // single-key D5 family

function row(
  key: string,
  state: State,
  opts: { observedAt?: string; signal?: unknown; failCount?: number } = {},
): StatusRow {
  const observed = opts.observedAt ?? FRESH;
  return {
    id: `id-${key}`,
    key,
    dimension: key.split(":")[0] ?? "",
    state,
    signal: "signal" in opts ? opts.signal : null,
    observed_at: observed,
    transitioned_at: observed,
    fail_count: opts.failCount ?? (state === "red" ? 1 : 0),
    first_failure_at: state === "red" ? observed : null,
  };
}

const wired = (featureId: string | null): CellModelInput => ({
  slug: SLUG,
  featureId,
  isSupported: true,
  isWired: true,
});

function greenBase(feature: string, observedAt = FRESH): StatusRow[] {
  const rows = [
    row(keyFor("health", SLUG), "green", { observedAt }),
    row(keyFor("agent", SLUG), "green", { observedAt }),
    row(keyFor("e2e", SLUG, feature), "green", { observedAt }),
    row(keyFor("chat", SLUG), "green", { observedAt }),
    row(keyFor("tools", SLUG), "green", { observedAt }),
  ];
  for (const ft of CATALOG_TO_D5_KEY[feature] ?? []) {
    rows.push(row(keyFor("d5", SLUG, ft), "green", { observedAt }));
    rows.push(row(keyFor("d6", SLUG, ft), "green", { observedAt }));
  }
  return rows;
}

describe("§7 I1: single-absent lower rung → gray", () => {
  it("D3 absent, green D4/D5/D6 → gray (was false-green)", () => {
    const live = mergeRowsToMap(
      greenBase(F).filter((r) => !r.key.startsWith("e2e:")),
    );
    expect(buildCellModel(live, wired(F), NOW).chipColor).toBe("gray");
  });
});

describe("§7 I2: stale-degraded rung → amber (not red)", () => {
  it("stale-green D5 → amber", () => {
    const live = mergeRowsToMap(
      greenBase(F).map((r) =>
        r.key.startsWith("d5:")
          ? row(r.key, "green", { observedAt: STALE })
          : r,
      ),
    );
    expect(buildCellModel(live, wired(F), NOW).chipColor).toBe("amber");
  });
});

describe("§7 I4: infra-only red is not a regression", () => {
  it("infra-red D3 → gray chip, isRegression false", () => {
    const live = mergeRowsToMap(
      greenBase(F).map((r) =>
        r.key.startsWith("e2e:")
          ? row(r.key, "red", { signal: { errorClass: "driver-error" } })
          : r,
      ),
    );
    const m = buildCellModel(live, wired(F), NOW);
    expect(m.chipColor).toBe("gray");
    expect(m.isRegression).toBe(false);
  });
});

describe("§7 I5: cold-load stripped signal → gray no-data", () => {
  it("red D3 with signal stripped → gray (never product-red)", () => {
    const live = mergeRowsToMap(
      greenBase(F).map((r) =>
        r.key.startsWith("e2e:") ? row(r.key, "red", { signal: undefined }) : r,
      ),
    );
    expect(buildCellModel(live, wired(F), NOW).chipColor).toBe("gray");
  });
});

describe("§7 §F: D1/D2 liveness gate", () => {
  it("present fresh-red D1 gates → red, achieved 0, regression", () => {
    const live = mergeRowsToMap(
      greenBase(F).map((r) =>
        r.key.startsWith("health:") ? row(r.key, "red") : r,
      ),
    );
    const m = buildCellModel(live, wired(F), NOW);
    expect(m.chipColor).toBe("red");
    expect(m.achievedDepth).toBe(0);
    expect(m.isRegression).toBe(true);
  });

  it("absent liveness over green ladder → green (non-gating, item 7)", () => {
    const live = mergeRowsToMap(
      greenBase(F).filter(
        (r) => !r.key.startsWith("health:") && !r.key.startsWith("agent:"),
      ),
    );
    const m = buildCellModel(live, wired(F), NOW);
    expect(m.chipColor).toBe("green");
    expect(m.achievedDepth).toBe(6);
    expect(m.isRegression).toBe(false);
  });
});

describe("§7 §C: first-strike de-amplification", () => {
  it("D4 fresh red fail_count 1 → amber; fail_count 2 → red", () => {
    const mk = (fc: number) =>
      mergeRowsToMap(
        greenBase(F).map((r) =>
          r.key.startsWith("chat:") ? row(r.key, "red", { failCount: fc }) : r,
        ),
      );
    expect(buildCellModel(mk(1), wired(F), NOW).chipColor).toBe("amber");
    expect(buildCellModel(mk(2), wired(F), NOW).chipColor).toBe("red");
  });

  it("starter soft-miss fail_count 1 → amber chip", () => {
    const col = "langgraph-python";
    const levels = ["health", "agent", "chat", "interaction"];
    const live = mergeRowsToMap(
      levels.map((lvl, i) =>
        i === 0
          ? row(keyFor("starter", col, lvl), "red", {
              signal: { errorClass: "transport-error" },
              failCount: 1,
            })
          : row(keyFor("starter", col, lvl), "green"),
      ),
    );
    const input: CellModelInput = {
      slug: col,
      featureId: "starter",
      isSupported: true,
      isWired: true,
      probeAxis: "starter",
    };
    expect(buildCellModel(live, input, NOW).chipColor).toBe("amber");
  });
});

describe("§7 §E: future-skew clamp", () => {
  it("future-skewed green D3 → amber, non-negative freshest age", () => {
    const live = mergeRowsToMap(
      greenBase(F).map((r) =>
        r.key.startsWith("e2e:")
          ? row(r.key, "green", { observedAt: FUTURE })
          : r,
      ),
    );
    const m = buildCellModel(live, wired(F), NOW);
    expect(m.chipColor).toBe("amber");
    expect((m.observedAtAgeMs ?? -1) >= 0).toBe(true);
  });
});

describe("U8 freshness — the D2 `agent` row is a contributing row", () => {
  it("a cell fresh ONLY on its agent (D2) row is NOT stale-grayed", () => {
    // A D5-unmapped feature so only e2e/chat/tools/health/agent contribute.
    const F_UNMAPPED = "no-such-d5-feature";
    const live = mergeRowsToMap([
      row(keyFor("health", SLUG), "green", { observedAt: STALE }),
      row(keyFor("e2e", SLUG, F_UNMAPPED), "green", { observedAt: STALE }),
      row(keyFor("chat", SLUG), "green", { observedAt: STALE }),
      row(keyFor("tools", SLUG), "green", { observedAt: STALE }),
      // The ONLY fresh observation is the D2 agent row.
      row(keyFor("agent", SLUG), "green", { observedAt: FRESH }),
    ]);
    const m = buildCellModel(live, wired(F_UNMAPPED), NOW);
    // Pre-fix: `agent` is never scanned → every scanned row is stale →
    // isStaleCell true → chip grayed and observedAtAgeMs reports the STALE age.
    expect(m.isStaleCell).toBe(false);
    // The freshest contributing observation is the ~60s-old agent row, not the
    // ~6h-old stale rows.
    expect(m.observedAtAgeMs).not.toBeNull();
    expect(m.observedAtAgeMs).toBeLessThan(E2E_STALE_AFTER_MS);
  });
});

describe("empty-string featureId does not crash the matrix render (keyFor guard)", () => {
  it("an empty featureId is treated as a null-feature liveness cell, not a throw", () => {
    const live = mergeRowsToMap([
      row(keyFor("health", SLUG), "green"),
      row(keyFor("agent", SLUG), "green"),
    ]);
    // Pre-fix: featureId "" !== null falls into the agent path → keyFor("e2e",
    // slug, "") throws → the whole buildCellModel (and matrix render) crashes.
    expect(() => buildCellModel(live, wired(""), NOW)).not.toThrow();
    const m = buildCellModel(live, wired(""), NOW);
    expect(m.ceilingDepth).toBe(2); // routed to the liveness-only ladder
    expect(m.chipColor).toBe("green");
  });
});

describe("starter supported-but-unwired is gray no-data, not UNSUPPORTED", () => {
  it("an unshipped starter (isSupported true, isWired false) stays supported", () => {
    const input: CellModelInput = {
      slug: "langgraph-python",
      featureId: "starter",
      isSupported: true,
      isWired: false,
      probeAxis: "starter",
    };
    const m = buildCellModel(mergeRowsToMap([]), input, NOW);
    // Pre-fix: the starter branch returns the shared UNSUPPORTED singleton
    // (supported:false), contradicting isSupported:true and diverging from the
    // agent path (which returns supported:true gray for the same combination).
    expect(m.supported).toBe(true);
    expect(m.chipColor).toBe("gray");
  });
});

describe("T4 null-feature liveness-only path (NEW capability)", () => {
  it("green D1+D2, feature null → green, achieved 2, ceiling 2", () => {
    const live = mergeRowsToMap([
      row(keyFor("health", SLUG), "green"),
      row(keyFor("agent", SLUG), "green"),
    ]);
    const m = buildCellModel(live, wired(null), NOW);
    expect(m.chipColor).toBe("green");
    expect(m.achievedDepth).toBe(2);
    expect(m.ceilingDepth).toBe(2);
    expect(m.isRegression).toBe(false);
    expect(m.d6Effective).toBeNull();
  });

  it("absent D1 + green D2, feature null → gray AND achieved < ceiling (coherent)", () => {
    // D1 (health) absent, D2 (agent) green. A null-feature cell's ladder IS
    // D1/D2, so an absent D1 breaks contiguity — the chip is gray (unverified)
    // and achieved must NOT report the ceiling as reached.
    const live = mergeRowsToMap([row(keyFor("agent", SLUG), "green")]);
    const m = buildCellModel(live, wired(null), NOW);
    expect(m.chipColor).toBe("gray");
    expect(m.achievedDepth).toBeLessThan(m.ceilingDepth);
    expect(m.achievedDepth).toBe(0);
    expect(m.isRegression).toBe(false);
  });

  it("fresh-red D1, feature null → red, achieved 0, regression", () => {
    const live = mergeRowsToMap([
      row(keyFor("health", SLUG), "red"),
      row(keyFor("agent", SLUG), "green"),
    ]);
    const m = buildCellModel(live, wired(null), NOW);
    expect(m.chipColor).toBe("red");
    expect(m.achievedDepth).toBe(0);
    expect(m.isRegression).toBe(true);
  });
});
