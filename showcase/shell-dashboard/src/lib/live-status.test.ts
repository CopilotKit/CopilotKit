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
    expect(keyFor("e2e_smoke", "agno", "agentic-chat")).toBe(
      "e2e_smoke:agno/agentic-chat",
    );
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

describe("resolveCell — post-Phase 3 (rollup uses health + e2e_smoke only)", () => {
  // Order: red > degraded > green > error > unknown.
  // Rollup contributors: health, e2e_smoke (Decision #7: smokeRow dropped).

  it("rolls up to red when any contributing dimension is red", () => {
    const live = mapOf([
      row("health:agno", "health", "red"),
      row("e2e_smoke:agno/ac", "e2e_smoke", "green"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("red");
  });

  it("rolls up to degraded when no red but any degraded", () => {
    const live = mapOf([
      row("health:agno", "health", "green"),
      row("e2e_smoke:agno/ac", "e2e_smoke", "degraded"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("amber");
  });

  it("rolls up to green when health present+green and e2e_smoke absent", () => {
    const live = mapOf([row("health:agno", "health", "green")]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("green");
  });

  it("rolls up to green when health+e2e_smoke both green", () => {
    const live = mapOf([
      row("health:agno", "health", "green"),
      row("e2e_smoke:agno/ac", "e2e_smoke", "green"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("green");
  });

  it("rolls up to unknown when health is missing", () => {
    const live = mapOf([row("e2e_smoke:agno/ac", "e2e_smoke", "green")]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("gray");
  });

  it("rolls up to gray when no rows at all", () => {
    const live = mapOf([]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("gray");
  });

  it("hook-level error tone overrides missing-data (unknown) via connection param", () => {
    const live = mapOf([]);
    const c = resolveCell(live, "agno", "ac", { connection: "error" });
    expect(c.rollup).toBe("error");
  });

  it("full truth-table — red beats degraded beats green beats unknown", () => {
    const combos: Array<{
      health: StatusRow["state"] | null;
      e2e: StatusRow["state"] | null;
      expect: string;
    }> = [
      { health: "red", e2e: "green", expect: "red" },
      { health: "green", e2e: "red", expect: "red" },
      { health: "degraded", e2e: "green", expect: "amber" },
      { health: "green", e2e: "degraded", expect: "amber" },
      { health: "green", e2e: "green", expect: "green" },
      { health: "green", e2e: null, expect: "green" },
      { health: null, e2e: "green", expect: "gray" },
      { health: null, e2e: null, expect: "gray" },
      { health: "red", e2e: "degraded", expect: "red" },
      { health: "degraded", e2e: "degraded", expect: "amber" },
    ];
    for (const c of combos) {
      const rows: StatusRow[] = [];
      if (c.health) rows.push(row("health:a", "health", c.health));
      if (c.e2e) rows.push(row("e2e_smoke:a/b", "e2e_smoke", c.e2e));
      const out = resolveCell(mapOf(rows), "a", "b");
      expect(out.rollup, JSON.stringify(c)).toBe(c.expect);
    }
  });

  it("per-badge tones match spec §5.4 table", () => {
    const live = mapOf([
      row("smoke:a/b", "smoke", "green"),
      row("health:a", "health", "red"),
      row("e2e_smoke:a/b", "e2e_smoke", "degraded"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.smoke.tone).toBe("green");
    expect(c.health.tone).toBe("red");
    expect(c.e2e.tone).toBe("amber");
  });

  it("unknown badges render label '?' and tone 'gray'", () => {
    const c = resolveCell(mapOf([]), "a", "b");
    expect(c.smoke.tone).toBe("gray");
    expect(c.smoke.label).toBe("?");
    expect(c.health.tone).toBe("gray");
    expect(c.health.label).toBe("?");
  });

  it("health green with e2e_smoke=null rolls up to green (C5 F13)", () => {
    const live = mapOf([row("health:a", "health", "green")]);
    const c = resolveCell(live, "a", "b");
    expect(c.rollup).toBe("green");
  });

  it("all-green rows + connection=error: rollup is error, NOT stale-green (R5 F5.1)", () => {
    const live = mapOf([
      row("health:a", "health", "green"),
      row("e2e_smoke:a/b", "e2e_smoke", "green"),
    ]);
    const c = resolveCell(live, "a", "b", { connection: "error" });
    expect(c.rollup).toBe("error");
    expect(c.rollup).not.toBe("green");
  });

  it("red row + connection=error: red wins over the hook error tone (C5 F14)", () => {
    const live = mapOf([row("health:a", "health", "red")]);
    const c = resolveCell(live, "a", "b", { connection: "error" });
    expect(c.rollup).toBe("red");
  });

  it("degraded does NOT render a green check glyph (C5 F12)", () => {
    const live = mapOf([
      row("smoke:a/b", "smoke", "degraded"),
      row("e2e_smoke:a/b", "e2e_smoke", "degraded"),
      row("health:a", "health", "degraded"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.smoke.label).not.toBe("✓");
    expect(c.e2e.label).not.toBe("✓");
    expect(c.health.label).not.toBe("up");
    expect(c.health.label).not.toBe("?");
  });

  it("CellState no longer has qa property", () => {
    const c = resolveCell(mapOf([]), "a", "b");
    expect(c).not.toHaveProperty("qa");
  });
});
