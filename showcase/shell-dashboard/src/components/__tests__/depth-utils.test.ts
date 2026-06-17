/**
 * Unit tests for the depth-derivation utility (deriveDepth).
 * Covers the D0-D6 ladder walk, short-circuit on non-green, unshipped/
 * unsupported handling, maxPossible/isRegression computation, multi-key D5
 * mappings, and D5/D6 staleness downgrades.
 */
import { describe, it, expect } from "vitest";
import { deriveDepth } from "../depth-utils";
import type { CatalogCell } from "../depth-utils";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";

// Default `observed_at` is recent so green rows are not treated as stale by
// the e2e staleness downgrade (see depth-utils.ts / cell-model.ts). Tests
// that exercise staleness pass an explicit timestamp.
const FRESH_OBSERVED_AT = new Date().toISOString();

function row(
  key: string,
  dimension: string,
  state: StatusRow["state"],
  observedAt: string = FRESH_OBSERVED_AT,
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: {},
    observed_at: observedAt,
    transitioned_at: observedAt,
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

  it("D4 worst-state wins: green chat + red tools does NOT achieve D4", () => {
    // Unification D: D4 was `chatGreen || toolsGreen` (OR), which credited
    // D4 even when one half was red. Match cell-model's resolveD4 worst-
    // state-wins — a red tools row pulls D4 down so achieved caps at D3.
    const c = cell("lgp", "agentic-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
      row("tools:lgp", "tools", "red"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(3);
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

  // ── isRegression now compares against maxPossible, not historical max_depth ──

  it("isRegression is true when achieved < maxPossible (D5 mapping exists, 1P red)", () => {
    // "agentic-chat" has D5 mapping → maxPossible=6, achieved=4 → regression
    const c = cell("lgp", "agentic-chat", "wired", 4);
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
      row("d5:lgp/agentic-chat", "d5", "red"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(4);
    expect(result.maxPossible).toBe(6);
    expect(result.isRegression).toBe(true);
  });

  it("isRegression is false when achieved === maxPossible (no D5 mapping, D4 green)", () => {
    // "unknown-feature" has NO D5 mapping → maxPossible=4, achieved=4 → no regression
    const c = cell("lgp", "unknown-feature", "wired", 2);
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/unknown-feature", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(4);
    expect(result.maxPossible).toBe(4);
    expect(result.isRegression).toBe(false);
  });

  it("isRegression is true when health drops (maxPossible > 0)", () => {
    // "agentic-chat" has D5 mapping → maxPossible=6, health red → achieved=0
    const c = cell("lgp", "agentic-chat", "wired", 1);
    const live = mapOf([row("health:lgp", "health", "red")]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(0);
    expect(result.maxPossible).toBe(6);
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

  it("returns D5 for shared-state-read-write when its single d5 row (write) is green", () => {
    // shared-state-read-write maps to ["shared-state-write"] only —
    // the read literal is owned by the standalone /demos/shared-state-read
    // recipe-editor probe and writes to its own d5:lgp/shared-state-read
    // row that does NOT factor into this cell's depth calculation.
    const c = cell("lgp", "shared-state-read-write");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/shared-state-read-write", "e2e", "green"),
      row("tools:lgp", "tools", "green"),
      row("d5:lgp/shared-state-write", "d5", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(5);
  });

  it("returns D4 when shared-state-read-write's d5 write row is red", () => {
    const c = cell("lgp", "shared-state-read-write");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/shared-state-read-write", "e2e", "green"),
      row("tools:lgp", "tools", "green"),
      row("d5:lgp/shared-state-write", "d5", "red"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(4);
  });

  it("returns D5 for multi-key D5 mapping (beautiful-chat → 5 per-pill literals)", () => {
    // beautiful-chat is the canonical multi-key example: it maps to 5
    // per-pill literals (toggle-theme / pie-chart / bar-chart /
    // search-flights / schedule-meeting). The cell hits D5 only when
    // every pill row is green.
    const c = cell("lgp", "beautiful-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/beautiful-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
      row("d5:lgp/beautiful-chat-toggle-theme", "d5", "green"),
      row("d5:lgp/beautiful-chat-pie-chart", "d5", "green"),
      row("d5:lgp/beautiful-chat-bar-chart", "d5", "green"),
      row("d5:lgp/beautiful-chat-search-flights", "d5", "green"),
      row("d5:lgp/beautiful-chat-schedule-meeting", "d5", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(5);
  });

  it("returns D4 when ONE of beautiful-chat's 5 multi-key D5 rows is red", () => {
    const c = cell("lgp", "beautiful-chat");
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/beautiful-chat", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
      row("d5:lgp/beautiful-chat-toggle-theme", "d5", "green"),
      row("d5:lgp/beautiful-chat-pie-chart", "d5", "red"),
      row("d5:lgp/beautiful-chat-bar-chart", "d5", "green"),
      row("d5:lgp/beautiful-chat-search-flights", "d5", "green"),
      row("d5:lgp/beautiful-chat-schedule-meeting", "d5", "green"),
    ]);
    const result = deriveDepth(c, live);
    expect(result.achieved).toBe(4);
  });

  it("returns D6 when D0-D5 green plus D6 green (per-cell key)", () => {
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

  // ── D5/D6 staleness mirrors cell-model.ts (both consumers agree) ──
  describe("D5/D6 staleness downgrade", () => {
    const NOW = Date.parse("2026-05-30T12:00:00Z");
    const STALE_AT = new Date(NOW - 7 * 60 * 60 * 1000).toISOString();
    const FRESH_AT = new Date(NOW - 60 * 1000).toISOString();

    it("does not credit D5 when its green row is stale", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", FRESH_AT),
        row("agent:lgp", "agent", "green", FRESH_AT),
        row("e2e:lgp/agentic-chat", "e2e", "green", FRESH_AT),
        row("chat:lgp", "chat", "green", FRESH_AT),
        row("d5:lgp/agentic-chat", "d5", "green", STALE_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      // Stale green D5 must not advance past D4.
      expect(result.achieved).toBe(4);
    });

    it("credits D5 when its green row is fresh", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", FRESH_AT),
        row("agent:lgp", "agent", "green", FRESH_AT),
        row("e2e:lgp/agentic-chat", "e2e", "green", FRESH_AT),
        row("chat:lgp", "chat", "green", FRESH_AT),
        row("d5:lgp/agentic-chat", "d5", "green", FRESH_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      expect(result.achieved).toBe(5);
    });

    it("does not credit D6 when its green row is stale", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", FRESH_AT),
        row("agent:lgp", "agent", "green", FRESH_AT),
        row("e2e:lgp/agentic-chat", "e2e", "green", FRESH_AT),
        row("chat:lgp", "chat", "green", FRESH_AT),
        row("d5:lgp/agentic-chat", "d5", "green", FRESH_AT),
        row("d6:lgp/agentic-chat", "d6", "green", STALE_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      // Stale green D6 must not advance past D5.
      expect(result.achieved).toBe(5);
    });

    it("credits D6 when its green row is fresh", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", FRESH_AT),
        row("agent:lgp", "agent", "green", FRESH_AT),
        row("e2e:lgp/agentic-chat", "e2e", "green", FRESH_AT),
        row("chat:lgp", "chat", "green", FRESH_AT),
        row("d5:lgp/agentic-chat", "d5", "green", FRESH_AT),
        row("d6:lgp/agentic-chat", "d6", "green", FRESH_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      expect(result.achieved).toBe(6);
    });
  });

  // ── D1/D2/D4 staleness downgrade (per-driver windows) ──
  // Liveness (D1/D2) and real-time (D4) green rows from a stalled driver
  // must not credit their depth. D1/D2 use LIVENESS_STALE_AFTER_MS (45m),
  // D4 uses D4_STALE_AFTER_MS (1h); both mirror cell-model.ts.
  describe("D1/D2/D4 staleness downgrade", () => {
    const NOW = Date.parse("2026-05-30T12:00:00Z");
    // Stale past every window in use (e2e 6h is the widest).
    const STALE_AT = new Date(NOW - 7 * 60 * 60 * 1000).toISOString();
    const FRESH_AT = new Date(NOW - 60 * 1000).toISOString();
    // Older than 45m (D1/D2 window) but within the D4 1h window — proves the
    // windows are independent: D1/D2 downgrade here while D4 would not.
    const STALE_LIVENESS_AT = new Date(NOW - 50 * 60 * 1000).toISOString();
    // Older than 1h (D4 window).
    const STALE_D4_AT = new Date(NOW - 70 * 60 * 1000).toISOString();

    it("does not credit D1 when its green health row is stale", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", STALE_LIVENESS_AT),
        row("agent:lgp", "agent", "green", FRESH_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      // Stale green health → D1 not credited → achieved caps at D0.
      expect(result.achieved).toBe(0);
    });

    it("credits D1 when its green health row is fresh", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([row("health:lgp", "health", "green", FRESH_AT)]);
      const result = deriveDepth(c, live, NOW);
      expect(result.achieved).toBe(1);
    });

    it("does not credit D2 when its green agent row is stale", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", FRESH_AT),
        row("agent:lgp", "agent", "green", STALE_LIVENESS_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      // Stale green agent → D2 not credited → caps at D1.
      expect(result.achieved).toBe(1);
    });

    it("credits D2 when its green agent row is fresh", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", FRESH_AT),
        row("agent:lgp", "agent", "green", FRESH_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      expect(result.achieved).toBe(2);
    });

    it("does not credit D4 when its green chat row is stale", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", FRESH_AT),
        row("agent:lgp", "agent", "green", FRESH_AT),
        row("e2e:lgp/agentic-chat", "e2e", "green", FRESH_AT),
        row("chat:lgp", "chat", "green", STALE_D4_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      // Stale green chat → D4 not credited → caps at D3.
      expect(result.achieved).toBe(3);
    });

    it("credits D4 when its green chat row is fresh", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", FRESH_AT),
        row("agent:lgp", "agent", "green", FRESH_AT),
        row("e2e:lgp/agentic-chat", "e2e", "green", FRESH_AT),
        row("chat:lgp", "chat", "green", FRESH_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      expect(result.achieved).toBe(4);
    });

    it("D1/D2 window is tighter than D4: a 50m-old D4 row would still count", () => {
      // A chat row 50m old is stale for liveness (45m) but fresh for D4 (1h).
      // This guards against collapsing the two windows into one constant.
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green", FRESH_AT),
        row("agent:lgp", "agent", "green", FRESH_AT),
        row("e2e:lgp/agentic-chat", "e2e", "green", FRESH_AT),
        row("chat:lgp", "chat", "green", STALE_LIVENESS_AT),
      ]);
      const result = deriveDepth(c, live, NOW);
      // 50m < D4's 1h window → D4 still credited.
      expect(result.achieved).toBe(4);
    });

    it("leaves a stale RED liveness row red (no false-credit either way)", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([row("health:lgp", "health", "red", STALE_AT)]);
      const result = deriveDepth(c, live, NOW);
      expect(result.achieved).toBe(0);
    });
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

  // ── maxPossible computation ──

  describe("maxPossible", () => {
    it("(a) D5 mapping exists, D5 green but D6 missing → achieved=5, maxPossible=6, regression", () => {
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
      expect(result.maxPossible).toBe(6);
      // achieved < maxPossible → regression (D6 not yet achieved)
      expect(result.isRegression).toBe(true);
    });

    it("(a-full) D5+D6 green → achieved=6, maxPossible=6, at ceiling", () => {
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
      expect(result.maxPossible).toBe(6);
      // achieved === maxPossible → at ceiling, no regression
      expect(result.isRegression).toBe(false);
    });

    it("(b) D5 mapping exists, 1P red → achieved=4, maxPossible=6, chip=AMBER territory", () => {
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
      expect(result.maxPossible).toBe(6);
      expect(result.isRegression).toBe(true);
    });

    it("(c) D5 mapping exists, 1P no data → achieved=4, maxPossible=6, chip=AMBER territory", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green"),
        row("agent:lgp", "agent", "green"),
        row("e2e:lgp/agentic-chat", "e2e", "green"),
        row("chat:lgp", "chat", "green"),
        // no d5 row at all
      ]);
      const result = deriveDepth(c, live);
      expect(result.achieved).toBe(4);
      expect(result.maxPossible).toBe(6);
      expect(result.isRegression).toBe(true);
    });

    it("(d) NO D5 mapping, D4 green → achieved=4, maxPossible=4, chip=GREEN territory", () => {
      const c = cell("lgp", "unknown-feature");
      const live = mapOf([
        row("health:lgp", "health", "green"),
        row("agent:lgp", "agent", "green"),
        row("e2e:lgp/unknown-feature", "e2e", "green"),
        row("chat:lgp", "chat", "green"),
      ]);
      const result = deriveDepth(c, live);
      expect(result.achieved).toBe(4);
      expect(result.maxPossible).toBe(4);
      expect(result.isRegression).toBe(false);
    });

    it("(e) NO D5 mapping, D3 green → achieved=3, maxPossible=4, chip=AMBER territory", () => {
      const c = cell("lgp", "unknown-feature");
      const live = mapOf([
        row("health:lgp", "health", "green"),
        row("agent:lgp", "agent", "green"),
        row("e2e:lgp/unknown-feature", "e2e", "green"),
        // no chat/tools row → D4 not achieved
      ]);
      const result = deriveDepth(c, live);
      expect(result.achieved).toBe(3);
      expect(result.maxPossible).toBe(4);
      expect(result.isRegression).toBe(true);
    });

    it("(f) D2 with maxPossible=6 → chip=RED territory (4 levels below)", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([
        row("health:lgp", "health", "green"),
        row("agent:lgp", "agent", "green"),
        // e2e missing → achieved=2
      ]);
      const result = deriveDepth(c, live);
      expect(result.achieved).toBe(2);
      expect(result.maxPossible).toBe(6);
      // 6 - 2 = 4, which is > 2 → RED territory
      expect(result.isRegression).toBe(true);
    });

    it("(g) D0 → maxPossible reflects probe existence, regression if maxPossible > 0", () => {
      const c = cell("lgp", "agentic-chat");
      const live = mapOf([]); // no live data
      const result = deriveDepth(c, live);
      expect(result.achieved).toBe(0);
      expect(result.maxPossible).toBe(6); // D5 mapping exists → D6 reachable
      expect(result.isRegression).toBe(true);
    });

    it("(h) unsupported → unsupported=true, maxPossible=0, no regression", () => {
      const c = cell("lgp", "agentic-chat", "unsupported");
      const live = mapOf([row("health:lgp", "health", "green")]);
      const result = deriveDepth(c, live);
      expect(result.achieved).toBe(0);
      expect(result.maxPossible).toBe(0);
      expect(result.unsupported).toBe(true);
      expect(result.isRegression).toBe(false);
    });

    it("unshipped → maxPossible=0, no regression", () => {
      const c = cell("lgp", "agentic-chat", "unshipped");
      const live = mapOf([]);
      const result = deriveDepth(c, live);
      expect(result.achieved).toBe(0);
      expect(result.maxPossible).toBe(0);
      expect(result.isRegression).toBe(false);
    });

    it("stub with no live data → maxPossible=0, NOT a regression (stub = not-yet-wired)", () => {
      // A `stub` cell is "not yet wired", not "regressed". Treating it like
      // `unshipped` (maxPossible=0) means a stub with no probe data does not
      // light up the regression indicator. Pre-fix, computeMaxPossible gave a
      // stub the same 4/6 ceiling as a wired cell, so achieved=0 < maxPossible
      // falsely flagged isRegression.
      const c = cell("lgp", "agentic-chat", "stub");
      const live = mapOf([]);
      const result = deriveDepth(c, live);
      expect(result.achieved).toBe(0);
      expect(result.maxPossible).toBe(0);
      expect(result.isRegression).toBe(false);
    });

    it("null feature → maxPossible=2 (integration-scoped only)", () => {
      const c: CatalogCell = {
        id: "lgp/null",
        integration: "lgp",
        integration_name: "lgp",
        feature: null,
        feature_name: null,
        status: "wired",
        max_depth: 0,
        category: "dev-ex",
        category_name: "Dev Ex",
      };
      const live = mapOf([
        row("health:lgp", "health", "green"),
        row("agent:lgp", "agent", "green"),
      ]);
      const result = deriveDepth(c, live);
      expect(result.achieved).toBe(2);
      expect(result.maxPossible).toBe(2);
      expect(result.isRegression).toBe(false);
    });
  });
});
