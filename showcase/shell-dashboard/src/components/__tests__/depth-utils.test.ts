/**
 * Unit tests for depth derivation utility.
 * Parameterized: all D0-D6 combos, short-circuit on red, unshipped returns D0.
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
  max_depth: number = 0,
): CatalogCell => ({
  id: `${slug}/${featureId}`,
  integration: slug,
  integration_name: slug,
  feature: featureId,
  feature_name: featureId,
  status,
  max_depth,
  category: "dev-ex",
  category_name: "Dev Ex",
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
    expect(result.unsupported).toBe(false);
  });

  it("returns unsupported=true for unsupported cells regardless of live data", () => {
    // Unsupported cells are architectural exclusions — they never enter
    // the depth ladder. Even if integration-scoped probes (D1/D2) are
    // green, the result must flag unsupported so consumers render the
    // no-entry indicator instead of a numeric depth like D2.
    const c = cell("lgp", "voice", "unsupported");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("chat:lgp", "chat", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(0);
    expect(result.isRegression).toBe(false);
    expect(result.unsupported).toBe(true);
  });

  it("returns unsupported=false for wired cells", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.unsupported).toBe(false);
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

  it("isRegression is true when achieved depth < max_depth", () => {
    // Cell previously achieved D4 but now only achieves D2
    const c = cell("lgp", "agentic-chat", "wired", 4);
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(2);
    expect(result.isRegression).toBe(true);
  });

  it("isRegression is false when achieved depth >= max_depth", () => {
    // Cell max_depth is 2 and currently achieves D2 — no regression
    const c = cell("lgp", "agentic-chat", "wired", 2);
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(2);
    expect(result.isRegression).toBe(false);
  });

  it("isRegression is true when health drops and max_depth > 0", () => {
    // Cell had D1 previously but now health is red = D0
    const c = cell("lgp", "agentic-chat", "wired", 1);
    const live = mapOf([row("health:lgp", "health", "red")]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(0);
    expect(result.isRegression).toBe(true);
  });

  it("returns D5 when D0-D4 green plus D5 green (via CATALOG_TO_D5_KEY)", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
      row("d5:lgp/agentic-chat", "d5", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(5);
  });

  it("returns D4 when D5 row is red", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
      row("d5:lgp/agentic-chat", "d5", "red"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(4);
  });

  it("returns D4 when D5 row is missing", () => {
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

  it("returns D5 for multi-key D5 mapping (shared-state-read-write)", () => {
    const c = cell("lgp", "shared-state-read-write");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/shared-state-read-write", "e2e", "green"),
      row("tools:lgp", "tools", "green"),
      row("d5:lgp/shared-state-read", "d5", "green"),
      row("d5:lgp/shared-state-write", "d5", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(5);
  });

  it("returns D4 when one of multi-key D5 rows is red", () => {
    const c = cell("lgp", "shared-state-read-write");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/shared-state-read-write", "e2e", "green"),
      row("tools:lgp", "tools", "green"),
      row("d5:lgp/shared-state-read", "d5", "green"),
      row("d5:lgp/shared-state-write", "d5", "red"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(4);
  });

  it("returns D6 when D0-D5 green plus D6 green", () => {
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
      row("d5:lgp/agentic-chat", "d5", "green"),
      row("d6:lgp/agentic-chat", "d6", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(6);
  });

  it("returns D4 for feature with no D5 mapping", () => {
    const c = cell("lgp", "unknown-feature");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/unknown-feature", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(4);
  });
});
