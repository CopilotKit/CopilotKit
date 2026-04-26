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
  overrides: Partial<StatusRow> = {},
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
    ...overrides,
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
  it("d5 / d6 dimensions follow the same per-feature key shape", () => {
    // Drivers `e2e-deep` (B2) and `e2e-parity` (B13) emit side rows under
    // exactly these keys — the dashboard MUST match the producer shape.
    expect(keyFor("d5", "agno", "agentic-chat")).toBe("d5:agno/agentic-chat");
    expect(keyFor("d6", "agno", "tool-rendering")).toBe(
      "d6:agno/tool-rendering",
    );
  });
  it("throws when slug contains ':' (lookup-map collision guard)", () => {
    expect(() => keyFor("smoke", "bad:slug")).toThrow(/must not contain/);
  });
  it("throws when slug contains '/' (lookup-map collision guard)", () => {
    expect(() => keyFor("smoke", "bad/slug")).toThrow(/must not contain/);
  });
  it("throws when featureId contains ':' or '/'", () => {
    expect(() => keyFor("e2e", "agno", "bad:id")).toThrow(/must not contain/);
    expect(() => keyFor("e2e", "agno", "bad/id")).toThrow(/must not contain/);
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

describe("resolveCell — post-Phase 3 (rollup uses health + e2e only)", () => {
  // Order: red > degraded > green > error > unknown.
  // Rollup contributors: health, e2e (Decision #7: smokeRow dropped).

  it("rolls up to red when any contributing dimension is red", () => {
    const live = mapOf([
      row("health:agno", "health", "red"),
      row("e2e:agno/ac", "e2e", "green"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("red");
  });

  it("rolls up to degraded when no red but any degraded", () => {
    const live = mapOf([
      row("health:agno", "health", "green"),
      row("e2e:agno/ac", "e2e", "degraded"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("amber");
  });

  it("rolls up to green only when health AND e2e are green (LS1)", () => {
    // Stale-green guard (LS1): a missing e2e row is NOT green-eligible —
    // the cell must read "gray" until the e2e probe has actually ticked.
    const liveBoth = mapOf([
      row("health:agno", "health", "green"),
      row("e2e:agno/ac", "e2e", "green"),
    ]);
    expect(resolveCell(liveBoth, "agno", "ac").rollup).toBe("green");

    const liveHealthOnly = mapOf([row("health:agno", "health", "green")]);
    expect(resolveCell(liveHealthOnly, "agno", "ac").rollup).toBe("gray");

    const liveE2eOnly = mapOf([row("e2e:agno/ac", "e2e", "green")]);
    expect(resolveCell(liveE2eOnly, "agno", "ac").rollup).toBe("gray");
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
      { health: "green", e2e: null, expect: "gray" },
      { health: null, e2e: "green", expect: "gray" },
      { health: null, e2e: null, expect: "gray" },
      { health: "red", e2e: "degraded", expect: "red" },
      { health: "degraded", e2e: "degraded", expect: "amber" },
    ];
    for (const c of combos) {
      const rows: StatusRow[] = [];
      if (c.health) rows.push(row("health:a", "health", c.health));
      if (c.e2e) rows.push(row("e2e:a/b", "e2e", c.e2e));
      const out = resolveCell(mapOf(rows), "a", "b");
      expect(out.rollup, JSON.stringify(c)).toBe(c.expect);
    }
  });

  it("per-badge tones match spec §5.4 table", () => {
    // smoke is integration-scoped (LS11): producer emits `smoke:<slug>`,
    // not `smoke:<slug>/<featureId>`.
    const live = mapOf([
      row("smoke:a", "smoke", "green"),
      row("health:a", "health", "red"),
      row("e2e:a/b", "e2e", "degraded"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.smoke.tone).toBe("green");
    expect(c.health.tone).toBe("red");
    expect(c.e2e.tone).toBe("amber");
  });

  it("smoke lookup uses integration-scoped key (LS11) — feature-keyed rows are NOT visible", () => {
    // Regression guard: pre-fix, resolveCell looked up `smoke:a/b`,
    // which always missed because the producer emits `smoke:a`. The
    // dashboard must populate the smoke badge from the integration-
    // scoped key.
    const live = mapOf([
      row("smoke:a", "smoke", "red"),
      // A bogus per-feature smoke row must NOT bleed into resolveCell.
      row("smoke:a/b", "smoke", "green"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.smoke.tone).toBe("red");
    expect(c.smoke.row?.key).toBe("smoke:a");
  });

  it("unknown badges render label '?' and tone 'gray'", () => {
    const c = resolveCell(mapOf([]), "a", "b");
    expect(c.smoke.tone).toBe("gray");
    expect(c.smoke.label).toBe("?");
    expect(c.health.tone).toBe("gray");
    expect(c.health.label).toBe("?");
  });

  it("all-green rows + connection=error: rollup is error, NOT stale-green (R5 F5.1)", () => {
    const live = mapOf([
      row("health:a", "health", "green"),
      row("e2e:a/b", "e2e", "green"),
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
      row("smoke:a", "smoke", "degraded"),
      row("e2e:a/b", "e2e", "degraded"),
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

  it("resolves d5 / d6 per-feature rows when present", () => {
    const live = mapOf([
      row("d5:agno/agentic-chat", "d5", "green"),
      row("d6:agno/agentic-chat", "d6", "red"),
    ]);
    const c = resolveCell(live, "agno", "agentic-chat");
    expect(c.d5.tone).toBe("green");
    expect(c.d5.label).toBe("✓");
    expect(c.d5.row?.key).toBe("d5:agno/agentic-chat");
    expect(c.d6.tone).toBe("red");
    expect(c.d6.label).toBe("✗");
    expect(c.d6.row?.key).toBe("d6:agno/agentic-chat");
  });

  it("falls through to gray '?' when d5 / d6 rows are absent", () => {
    // Resting state for D6 cells outside their weekly-rotation slot — the
    // missing row must NOT panic-render or shift the rollup tone.
    const c = resolveCell(mapOf([]), "agno", "agentic-chat");
    expect(c.d5.tone).toBe("gray");
    expect(c.d5.label).toBe("?");
    expect(c.d6.tone).toBe("gray");
    expect(c.d6.label).toBe("?");
    expect(c.d5.row).toBeNull();
    expect(c.d6.row).toBeNull();
  });

  it("d5 / d6 do NOT contribute to the rollup (informational only)", () => {
    // Mirrors smoke's post-Phase-3 behaviour: a red d5/d6 row alone must
    // not flip the cell's rollup to red — the alert engine routes those
    // dimensions independently. Only health + e2e drive the rollup.
    // Note: with LS1 in force, health-only does NOT roll up to green
    // (e2e is also required); rollup is "gray" and the red d5/d6 rows
    // must not promote it to red.
    const live = mapOf([
      row("health:agno", "health", "green"),
      row("d5:agno/ac", "d5", "red"),
      row("d6:agno/ac", "d6", "red"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("gray");
    expect(c.d5.tone).toBe("red");
    expect(c.d6.tone).toBe("red");
  });

  it("d5 degraded renders amber tone with '~' label (not green check)", () => {
    const live = mapOf([row("d5:agno/ac", "d5", "degraded")]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.d5.tone).toBe("amber");
    expect(c.d5.label).toBe("~");
  });

  it("d5 / d6 lookups ignore unrelated keys", () => {
    // Defensive: an `e2e:slug/feature` row must not be visible through
    // the d5 / d6 slots even if a key resolver bug confused dimensions.
    const live = mapOf([row("e2e:agno/ac", "e2e", "red")]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.d5.row).toBeNull();
    expect(c.d6.row).toBeNull();
  });
});

describe("formatTooltip behaviour (via resolveCell)", () => {
  it("degraded tooltip drops the hardcoded '>6h' threshold (LS2)", () => {
    const live = mapOf([
      row("e2e:a/b", "e2e", "degraded", {
        observed_at: "2026-04-22T08:00:00Z",
      }),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.e2e.tooltip).not.toMatch(/>6h/);
    expect(c.e2e.tooltip).toContain("stale");
    expect(c.e2e.tooltip).toContain("2026-04-22T08:00:00Z");
  });

  it("red tooltip surfaces non-empty signal summary (LS8)", () => {
    const live = mapOf([
      row("e2e:a/b", "e2e", "red", {
        signal: { reason: "timeout", attempt: 3 },
      }),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.e2e.tooltip).toContain("red since");
    expect(c.e2e.tooltip).toContain("timeout");
  });

  it("red tooltip omits signal suffix when signal is empty object (LS8)", () => {
    const live = mapOf([
      row("e2e:a/b", "e2e", "red", {
        signal: {},
      }),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.e2e.tooltip).toMatch(/^e2e red since /);
    expect(c.e2e.tooltip).not.toContain("—");
  });

  it("red tooltip truncates long signal summaries to 80 chars (LS8)", () => {
    const long = "x".repeat(500);
    const live = mapOf([row("e2e:a/b", "e2e", "red", { signal: long })]);
    const c = resolveCell(live, "a", "b");
    // Truncation marker present, total signal segment <= 80 chars.
    expect(c.e2e.tooltip).toContain("...");
    const sigPart = c.e2e.tooltip.split(" — ")[1] ?? "";
    expect(sigPart.length).toBeLessThanOrEqual(80);
  });

  it("connection=error + red row: appends last-known-state context (LS9)", () => {
    const live = mapOf([
      row("e2e:a/b", "e2e", "red", {
        transitioned_at: "2026-04-22T09:00:00Z",
      }),
    ]);
    const c = resolveCell(live, "a", "b", { connection: "error" });
    expect(c.e2e.tooltip).toContain("dashboard offline (§5.3)");
    expect(c.e2e.tooltip).toContain("last observed");
    expect(c.e2e.tooltip).toContain("e2e red");
    expect(c.e2e.tooltip).toContain("2026-04-22T09:00:00Z");
  });

  it("connection=error + green row: plain offline tooltip (no last-observed context)", () => {
    const live = mapOf([row("e2e:a/b", "e2e", "green")]);
    const c = resolveCell(live, "a", "b", { connection: "error" });
    expect(c.e2e.tooltip).toBe("dashboard offline (§5.3)");
  });

  it("connection=error + null row: plain offline tooltip", () => {
    const c = resolveCell(mapOf([]), "a", "b", { connection: "error" });
    expect(c.e2e.tooltip).toBe("dashboard offline (§5.3)");
  });
});
