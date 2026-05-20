import { describe, it, expect } from "vitest";
import { buildCellModel } from "../cell-model";
import type { CellModel, CellModelInput } from "../cell-model";
import type { LiveStatusMap, StatusRow, State } from "../live-status";
import { keyFor } from "../live-status";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function row(
  key: string,
  dimension: string,
  state: State,
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

function wiredInput(
  slug: string,
  featureId: string,
  overrides: Partial<CellModelInput> = {},
): CellModelInput {
  return {
    slug,
    featureId,
    isSupported: true,
    isWired: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCellModel", () => {
  // ── Bug 3 regression: unsupported cell ──────────────────────────────
  describe("unsupported cell (Bug 3 regression)", () => {
    it("returns gray chip with all null levels", () => {
      const live = mapOf([]);
      const input: CellModelInput = {
        slug: "agno",
        featureId: "agentic-chat",
        isSupported: false,
        isWired: false,
      };
      const model = buildCellModel(live, input);
      expect(model.supported).toBe(false);
      expect(model.d3).toBeNull();
      expect(model.d4).toBeNull();
      expect(model.d5).toBeNull();
      expect(model.achievedDepth).toBe(0);
      expect(model.ceilingDepth).toBe(0);
      expect(model.chipColor).toBe("gray");
      expect(model.isRegression).toBe(false);
    });

    it("ignores live data for unsupported cells", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
      ]);
      const model = buildCellModel(live, {
        slug: "agno",
        featureId: "agentic-chat",
        isSupported: false,
        isWired: true,
      });
      expect(model.supported).toBe(false);
      expect(model.chipColor).toBe("gray");
    });
  });

  // ── Not-wired cell ──────────────────────────────────────────────────
  describe("not-wired cell", () => {
    it("returns gray chip with exists=false on all levels", () => {
      const model = buildCellModel(mapOf([]), {
        slug: "agno",
        featureId: "agentic-chat",
        isSupported: true,
        isWired: false,
      });
      expect(model.supported).toBe(true);
      expect(model.d3).toEqual({ exists: false, status: null, row: null });
      expect(model.d4).toEqual({ exists: false, status: null, row: null });
      expect(model.d5).toEqual({ exists: false, status: null, row: null });
      expect(model.achievedDepth).toBe(0);
      expect(model.ceilingDepth).toBe(0);
      expect(model.chipColor).toBe("gray");
    });
  });

  // ── Bug 1 regression: D3 passing without health row ─────────────────
  describe("D3 passing without health row (Bug 1 regression)", () => {
    it("returns achievedDepth=3 when only D3 passes (no D5 mapping)", () => {
      // Use a featureId with no CATALOG_TO_D5_KEY mapping so ceiling=3
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.d3!.exists).toBe(true);
      expect(model.d3!.status).toBe("green");
      expect(model.achievedDepth).toBe(3);
      expect(model.ceilingDepth).toBe(3);
      expect(model.chipColor).toBe("green");
    });

    it("returns achievedDepth=3 when D3 passes and D5 exists but has no data", () => {
      // agentic-chat IS in CATALOG_TO_D5_KEY → D5 exists=true, status=null
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d3!.exists).toBe(true);
      expect(model.d3!.status).toBe("green");
      expect(model.d5!.exists).toBe(true);
      expect(model.d5!.status).toBeNull();
      expect(model.achievedDepth).toBe(3);
      // ceilingDepth requires contiguity: D4 doesn't exist → stops at 3
      expect(model.ceilingDepth).toBe(3);
      // achieved === ceiling → green
      expect(model.chipColor).toBe("green");
    });
  });

  // ── Bug 2 regression: D3+D4 pass, no D5 → green chip ───────────────
  describe("D3+D4 pass, no D5 exists (Bug 2 regression)", () => {
    it("returns green chip when achieved === ceiling", () => {
      // Use a featureId that has no CATALOG_TO_D5_KEY mapping
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.d3!.exists).toBe(true);
      expect(model.d3!.status).toBe("green");
      expect(model.d4!.exists).toBe(true);
      expect(model.d4!.status).toBe("green");
      expect(model.d5!.exists).toBe(false);
      expect(model.achievedDepth).toBe(4);
      expect(model.ceilingDepth).toBe(4);
      expect(model.chipColor).toBe("green");
    });
  });

  // ── D3+D4 pass, D5 exists but fails → amber chip ───────────────────
  describe("D3+D4 pass, D5 exists but fails", () => {
    it("returns amber chip (ceiling - achieved = 1)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d3!.status).toBe("green");
      expect(model.d4!.status).toBe("green");
      expect(model.d5!.exists).toBe(true);
      expect(model.d5!.status).toBe("red");
      expect(model.achievedDepth).toBe(4);
      expect(model.ceilingDepth).toBe(5);
      expect(model.chipColor).toBe("amber");
    });
  });

  // ── All three pass → D5 green ───────────────────────────────────────
  describe("all three depths pass", () => {
    it("returns green chip at D5", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.achievedDepth).toBe(5);
      expect(model.ceilingDepth).toBe(5);
      expect(model.chipColor).toBe("green");
    });
  });

  // ── D3 fails → D0 achieved, red chip ───────────────────────────────
  describe("D3 fails", () => {
    it("returns achievedDepth=0 and red chip when D3 fails (tests exist but none pass)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d3!.status).toBe("red");
      expect(model.achievedDepth).toBe(0);
      expect(model.ceilingDepth).toBe(5);
      // tests exist (ceiling > 0) but none pass → red
      expect(model.chipColor).toBe("red");
    });

    it("returns red chip when D3 is only depth and it fails", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.achievedDepth).toBe(0);
      expect(model.ceilingDepth).toBe(3);
      // tests exist (ceiling=3) but none pass → red
      expect(model.chipColor).toBe("red");
    });
  });

  // ── Gray vs red: no tests at all vs tests-exist-but-all-fail ────────
  describe("gray vs red chip for achievedDepth=0", () => {
    it("gray when ceilingDepth=0 (no tests exist at all)", () => {
      const model = buildCellModel(
        mapOf([]),
        wiredInput("agno", "no-d5-feature"),
      );
      expect(model.ceilingDepth).toBe(0);
      expect(model.achievedDepth).toBe(0);
      expect(model.chipColor).toBe("gray");
    });

    it("red when tests exist but all fail (ceilingDepth > 0)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.ceilingDepth).toBe(3);
      expect(model.achievedDepth).toBe(0);
      expect(model.chipColor).toBe("red");
    });
  });

  // ── D4 via tools instead of chat ────────────────────────────────────
  describe("D4 via tools row", () => {
    it("resolves D4 from tools:<slug> when chat is absent", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d4!.exists).toBe(true);
      expect(model.d4!.status).toBe("green");
      expect(model.d4!.row!.dimension).toBe("tools");
      expect(model.achievedDepth).toBe(4);
    });

    it("worst-state wins when both chat and tools exist", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d4!.exists).toBe(true);
      expect(model.d4!.status).toBe("red");
      expect(model.d4!.row!.dimension).toBe("tools");
    });
  });

  // ── D5 multi-key (CATALOG_TO_D5_KEY has multiple sub-keys) ──────────
  describe("D5 multi-key worst-state", () => {
    it("picks worst state across multiple D5 sub-keys", () => {
      // beautiful-chat maps to 5 sub-keys
      const live = mapOf([
        row(keyFor("e2e", "agno", "beautiful-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-toggle-theme"), "d5", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-pie-chart"), "d5", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-bar-chart"), "d5", "red"),
        row(
          keyFor("d5", "agno", "beautiful-chat-search-flights"),
          "d5",
          "green",
        ),
        row(
          keyFor("d5", "agno", "beautiful-chat-schedule-meeting"),
          "d5",
          "green",
        ),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "beautiful-chat"));
      expect(model.d5!.exists).toBe(true);
      expect(model.d5!.status).toBe("red");
      // D5 is red → achievedDepth stops at D4
      expect(model.achievedDepth).toBe(4);
      expect(model.ceilingDepth).toBe(5);
      expect(model.chipColor).toBe("amber");
    });

    it("returns green when all D5 sub-keys pass", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "beautiful-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-toggle-theme"), "d5", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-pie-chart"), "d5", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-bar-chart"), "d5", "green"),
        row(
          keyFor("d5", "agno", "beautiful-chat-search-flights"),
          "d5",
          "green",
        ),
        row(
          keyFor("d5", "agno", "beautiful-chat-schedule-meeting"),
          "d5",
          "green",
        ),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "beautiful-chat"));
      expect(model.d5!.status).toBe("green");
      expect(model.achievedDepth).toBe(5);
      expect(model.chipColor).toBe("green");
    });
  });

  // ── No live data at all → D0 gray ──────────────────────────────────
  describe("no live data", () => {
    it("returns gray chip with achievedDepth=0 and ceilingDepth=0", () => {
      const model = buildCellModel(
        mapOf([]),
        wiredInput("agno", "agentic-chat"),
      );
      expect(model.d3!.exists).toBe(false);
      expect(model.d4!.exists).toBe(false);
      // agentic-chat IS in CATALOG_TO_D5_KEY, so exists=true but status=null
      expect(model.d5!.exists).toBe(true);
      expect(model.d5!.status).toBeNull();
      // ceilingDepth requires contiguity: D5 only counts if D3+D4 exist
      expect(model.ceilingDepth).toBe(0);
      expect(model.achievedDepth).toBe(0);
      // both zero → gray (ceilingDepth === 0 → no tests exist at all)
      expect(model.chipColor).toBe("gray");
    });

    it("returns ceilingDepth=0 when no tests exist at all", () => {
      const model = buildCellModel(
        mapOf([]),
        wiredInput("agno", "no-d5-feature"),
      );
      expect(model.ceilingDepth).toBe(0);
      expect(model.chipColor).toBe("gray");
    });
  });

  // ── Degraded state maps to amber ───────────────────────────────────
  describe("degraded state → amber", () => {
    it("maps degraded D3 to amber status", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "degraded"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d3!.status).toBe("amber");
    });

    it("maps degraded D4 to amber status", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "degraded"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d4!.status).toBe("amber");
    });

    it("degraded D3 breaks contiguous chain (achievedDepth=0)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "degraded"),
        row(keyFor("chat", "agno"), "chat", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.achievedDepth).toBe(0);
    });
  });

  // ── Edge: D3 exists but no status row (no data yet) ─────────────────
  describe("D3 exists in map but D4/D5 do not", () => {
    it("ceilingDepth reflects only existing levels", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.ceilingDepth).toBe(3);
      expect(model.achievedDepth).toBe(3);
      expect(model.chipColor).toBe("green");
    });
  });

  // ── Contiguous chain breaks at D4 ──────────────────────────────────
  describe("contiguous chain breaks at D4", () => {
    it("D3 green, D4 red, D5 green → achievedDepth=3", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "red"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.achievedDepth).toBe(3);
      expect(model.ceilingDepth).toBe(5);
      // ceiling - achieved = 2 > 1 → red
      expect(model.chipColor).toBe("red");
    });
  });

  // ── isRegression is always false (stub for future) ─────────────────
  describe("isRegression", () => {
    it("is always false in current implementation", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.isRegression).toBe(false);
    });
  });
});
