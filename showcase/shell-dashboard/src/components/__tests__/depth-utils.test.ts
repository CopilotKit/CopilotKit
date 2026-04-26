/**
 * Unit tests for depth derivation utility.
 * Parameterized: all D0-D4 combos, short-circuit on red, unshipped returns D0.
 */
import { describe, it, expect } from "vitest";
import { deriveDepth } from "../depth-utils";
import type { CatalogCell } from "../depth-utils";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";

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
    fail_count: 0,
    first_failure_at: null,
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

const cell = (
  slug: string,
  featureId: string,
  status: CatalogCell["status"] = "wired",
): CatalogCell => ({
  id: `${slug}/${featureId}`,
  integration: slug,
  integration_name: slug,
  feature: featureId,
  feature_name: featureId,
  status,
  category: "dev-ex",
  category_name: "Dev Ex",
});

// Starter cells: feature === null. These represent the integration's CLI
// starter (no feature wired), and the depth ladder caps at D2 because D3
// (per-cell e2e) is not meaningful without a feature id.
const starter = (
  slug: string,
  status: CatalogCell["status"] = "wired",
): CatalogCell => ({
  id: `${slug}/__starter`,
  integration: slug,
  integration_name: slug,
  feature: null,
  feature_name: null,
  status,
  category: null,
  category_name: null,
});

describe("deriveDepth", () => {
  it("returns D0 for unshipped cells regardless of live data", () => {
    const c = cell("lgp", "voice", "unshipped");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("chat:lgp", "chat", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(0);
    expect(result.isRegression).toBe(false);
  });

  it("returns D0 for wired cell with no live data", () => {
    const c = cell("lgp", "agentic-chat");
    const result = deriveDepth(c, new Map());
    expect(result.achieved).toBe(0);
  });

  it("returns D0 for stub cell with no live data", () => {
    const c = cell("lgp", "cli-start", "stub");
    const result = deriveDepth(c, new Map());
    expect(result.achieved).toBe(0);
  });

  it("returns D1 when health is green but agent is not", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([row("health:lgp", "health", "green")]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(1);
  });

  it("returns D2 when health + agent are green", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(2);
  });

  it("returns D3 when health + agent + e2e are green", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(3);
  });

  it("returns D4 when all depths are green (chat path)", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(4);
  });

  it("returns D4 when all depths are green (tools path)", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("tools:lgp", "tools", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(4);
  });

  it("short-circuits: D1 red means D0 even if D2+ green", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "red"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
    ]);
    const result = deriveDepth(c, live);
    // health is red, so achieved = 0 (D0 only: cell exists)
    expect(result.achieved).toBe(0);
  });

  it("short-circuits: D2 red (agent red) means D1 even if D3+ green", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "red"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(1);
  });

  it("D3 skipped (no e2e row) means D2 even if D4 green", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      // no e2e row
      row("chat:lgp", "chat", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(2);
  });

  it("degraded state treated as not-green for depth walk", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "degraded"),
      row("agent:lgp", "agent", "green"),
    ]);
    const result = deriveDepth(c, live);
    // degraded health = not green = D0
    expect(result.achieved).toBe(0);
  });

  it("isRegression is always false for now", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.isRegression).toBe(false);
  });

  it("starter cell (feature null) caps at D2 with health+agent green", () => {
    const c = starter("lgp");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(2);
    expect(result.isRegression).toBe(false);
  });

  it("starter cell skips D3 even with chat+tools green", () => {
    const c = starter("lgp");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      // Even if these were green they cannot lift a starter past D2 because
      // D3 (e2e) is not evaluable without a feature id.
      row("chat:lgp", "chat", "green"),
      row("tools:lgp", "tools", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(2);
  });
});
