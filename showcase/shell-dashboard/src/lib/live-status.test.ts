import { describe, it, expect } from "vitest";
import {
  keyFor,
  resolveCell,
  upsertByKey,
  type LiveStatusMap,
  type StatusRow,
} from "./live-status";

function row(
  key: string,
  dimension: string,
  state: StatusRow["state"],
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: {},
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: state === "red" ? 1 : 0,
    first_failure_at: state === "red" ? "2026-04-20T00:00:00Z" : null,
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

describe("keyFor", () => {
  it("integration-level dimensions have no feature segment", () => {
    expect(keyFor("health", "agno")).toBe("health:agno");
  });
  it("per-feature dimensions append /<featureId>", () => {
    expect(keyFor("smoke", "agno", "agentic-chat")).toBe(
      "smoke:agno/agentic-chat",
    );
    expect(keyFor("e2e", "agno", "agentic-chat")).toBe("e2e:agno/agentic-chat");
  });
});

describe("upsertByKey", () => {
  it("appends when key is absent", () => {
    const a = row("k:1", "smoke", "green");
    const out = upsertByKey([], a);
    expect(out).toHaveLength(1);
  });
  it("replaces when key is present", () => {
    const a = row("k:1", "smoke", "green");
    const b = row("k:1", "smoke", "red");
    const out = upsertByKey([a], b);
    expect(out).toHaveLength(1);
    expect(out[0]!.state).toBe("red");
  });
});

describe("resolveCell — per-spec §5.4 multi-dim precedence", () => {
  // Order: red > degraded > green > error > unknown.
  // Rows considered for rollup: smoke, health, e2e (QA is informational).

  it("rolls up to red when any contributing dimension is red", () => {
    const live = mapOf([
      row("smoke:agno/ac", "smoke", "red"),
      row("health:agno", "health", "green"),
      row("e2e:agno/ac", "e2e", "green"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("red");
  });

  it("rolls up to degraded when no red but any degraded", () => {
    const live = mapOf([
      row("smoke:agno/ac", "smoke", "degraded"),
      row("health:agno", "health", "green"),
      row("e2e:agno/ac", "e2e", "green"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("amber");
  });

  it("rolls up to green when smoke+health present and green (e2e absent ok if not required)", () => {
    const live = mapOf([
      row("smoke:agno/ac", "smoke", "green"),
      row("health:agno", "health", "green"),
      row("e2e:agno/ac", "e2e", "green"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("green");
  });

  it("rolls up to unknown when any required dimension is missing", () => {
    const live = mapOf([row("smoke:agno/ac", "smoke", "green")]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("gray");
  });

  it("QA red does NOT poison the rollup (QA is informational only)", () => {
    const live = mapOf([
      row("smoke:agno/ac", "smoke", "green"),
      row("health:agno", "health", "green"),
      row("e2e:agno/ac", "e2e", "green"),
      row("qa:agno/ac", "qa", "red"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("green");
  });

  it("hook-level error tone overrides missing-data (unknown) via connection param", () => {
    const live = mapOf([]);
    const c = resolveCell(live, "agno", "ac", { connection: "error" });
    // Cell rollup becomes "error" tone (rendered as amber/muted per spec), not "gray"
    expect(c.rollup).toBe("error");
  });

  it("full truth-table smoke sanity — red beats degraded beats green beats unknown", () => {
    const combos: Array<{
      smoke: StatusRow["state"] | null;
      health: StatusRow["state"] | null;
      e2e: StatusRow["state"] | null;
      expect: string;
    }> = [
      { smoke: "red", health: "green", e2e: "green", expect: "red" },
      { smoke: "green", health: "red", e2e: "green", expect: "red" },
      { smoke: "green", health: "green", e2e: "red", expect: "red" },
      { smoke: "degraded", health: "green", e2e: "green", expect: "amber" },
      { smoke: "green", health: "degraded", e2e: "green", expect: "amber" },
      { smoke: "green", health: "green", e2e: "green", expect: "green" },
      { smoke: null, health: "green", e2e: "green", expect: "gray" },
      { smoke: "green", health: null, e2e: "green", expect: "gray" },
      { smoke: "red", health: "degraded", e2e: null, expect: "red" },
      { smoke: "degraded", health: null, e2e: "degraded", expect: "amber" }, // degraded wins over unknown when no red
    ];
    for (const c of combos) {
      const rows: StatusRow[] = [];
      if (c.smoke) rows.push(row("smoke:a/b", "smoke", c.smoke));
      if (c.health) rows.push(row("health:a", "health", c.health));
      if (c.e2e) rows.push(row("e2e:a/b", "e2e", c.e2e));
      const out = resolveCell(mapOf(rows), "a", "b");
      expect(out.rollup, JSON.stringify(c)).toBe(c.expect);
    }
  });

  it("per-badge tones match spec §5.4 table", () => {
    const live = mapOf([
      row("smoke:a/b", "smoke", "green"),
      row("health:a", "health", "red"),
      row("e2e:a/b", "e2e", "degraded"),
      row("qa:a/b", "qa", "red"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.smoke.tone).toBe("green");
    expect(c.health.tone).toBe("red");
    expect(c.e2e.tone).toBe("amber");
    expect(c.qa.tone).toBe("red");
  });

  it("unknown badges render label '?' and tone 'gray'", () => {
    const c = resolveCell(mapOf([]), "a", "b");
    expect(c.smoke.tone).toBe("gray");
    expect(c.smoke.label).toBe("?");
    expect(c.health.tone).toBe("gray");
    expect(c.health.label).toBe("?");
  });

  it("smoke+health green with e2e=null rolls up to green (C5 F13)", () => {
    // Explicit lock: `allGreen` treats a missing e2e row as acceptable
    // iff smoke AND health are green. Missing e2e + missing smoke/health
    // would fall through to gray; this test pins the green case.
    const live = mapOf([
      row("smoke:a/b", "smoke", "green"),
      row("health:a", "health", "green"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.rollup).toBe("green");
  });

  it("red row + connection=error: red wins over the hook error tone (C5 F14)", () => {
    // Locks the precedence clause — a genuine red signal must NOT be
    // hidden behind an "error" rollup when the stream is also down.
    const live = mapOf([
      row("smoke:a/b", "smoke", "red"),
      row("health:a", "health", "green"),
    ]);
    const c = resolveCell(live, "a", "b", { connection: "error" });
    expect(c.rollup).toBe("red");
  });

  it("degraded does NOT render a green check glyph (C5 F12)", () => {
    // Regression guard for the formatLabel bug where `state === "degraded"`
    // fell through to the `return "✓"` branch, rendering amber/degraded
    // cells with a "green check" glyph that contradicted the tooltip.
    const live = mapOf([
      row("smoke:a/b", "smoke", "degraded"),
      row("e2e:a/b", "e2e", "degraded"),
      row("qa:a/b", "qa", "degraded"),
      row("health:a", "health", "degraded"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.smoke.label).not.toBe("✓");
    expect(c.e2e.label).not.toBe("✓");
    expect(c.qa.label).not.toBe("✓");
    // Health gets its own vocabulary: degraded → "stale" (not "up"/"down"/"?").
    expect(c.health.label).not.toBe("up");
    expect(c.health.label).not.toBe("?");
  });
});
