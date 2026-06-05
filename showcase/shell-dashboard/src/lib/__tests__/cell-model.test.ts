import { describe, it, expect } from "vitest";
import {
  buildCellModel,
  E2E_STALE_AFTER_MS,
  D4_STALE_AFTER_MS,
} from "../cell-model";
import type { CellModelInput } from "../cell-model";
import type { LiveStatusMap, StatusRow, State } from "../live-status";
import { keyFor } from "../live-status";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// Default `observed_at` is recent so green rows are not treated as stale by
// the e2e staleness downgrade (resolveD3). The staleness tests below pass an
// explicit `observed_at` override to exercise the downgrade.
const FRESH_OBSERVED_AT = new Date().toISOString();

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
    observed_at: FRESH_OBSERVED_AT,
    transitioned_at: FRESH_OBSERVED_AT,
    fail_count: state === "red" ? 1 : 0,
    first_failure_at: state === "red" ? FRESH_OBSERVED_AT : null,
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
      expect(model.d6).toBeNull();
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
      // D6-ceiling: no D5 and no D6 exist → gray
      expect(model.chipColor).toBe("gray");
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
      // Contiguous-ladder: D5 exists but has no data (status null), D6
      // absent → unverified ladder → gray (no-data, not a failure).
      expect(model.chipColor).toBe("gray");
    });
  });

  // ── Bug 2 regression: D3+D4 pass, no D5 → green chip ───────────────
  describe("D3+D4 pass, no D5 exists (Bug 2 regression)", () => {
    it("returns gray chip when no D5/D6 exist (D6-ceiling)", () => {
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
      // D6-ceiling: no D5 and no D6 exist → gray
      expect(model.chipColor).toBe("gray");
    });
  });

  // ── D3+D4 pass, D5 exists but fails → red chip ─────────────────────
  describe("D3+D4 pass, D5 exists but fails", () => {
    it("returns red chip (D6-ceiling: D5 red, D6 absent)", () => {
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
      // agentic-chat is D6-mapped, so D6 EXISTS (mapped, unemitted) → ceiling 6.
      expect(model.ceilingDepth).toBe(6);
      // D6-ceiling: D5 not green → broken ladder → red
      expect(model.chipColor).toBe("red");
    });
  });

  // ── All three pass → D5 green ───────────────────────────────────────
  describe("D3+D4+D5 pass, no D6", () => {
    it("returns amber chip (D6-ceiling: D5 green but D6 unemitted)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.achievedDepth).toBe(5);
      // agentic-chat is D6-mapped, so D6 EXISTS (mapped, unemitted) → ceiling 6.
      expect(model.ceilingDepth).toBe(6);
      // D6-ceiling: D5 green but D6 not green → amber
      expect(model.chipColor).toBe("amber");
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
      // agentic-chat is D6-mapped, so D6 EXISTS (mapped, unemitted) → ceiling 6.
      expect(model.ceilingDepth).toBe(6);
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
      // beautiful-chat is D6-mapped (same featureType bridge as D5), so D6
      // EXISTS (mapped, unemitted → status null) → ceiling is 6.
      expect(model.ceilingDepth).toBe(6);
      // D6-ceiling: D5 not green → broken ladder → red
      expect(model.chipColor).toBe("red");
    });

    it("returns amber when all D5 sub-keys pass but no D6", () => {
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
      // D6-ceiling: D5 green but D6 absent → amber
      expect(model.chipColor).toBe("amber");
    });

    it("does not credit D5 green when one mapped sub-row is MISSING (strict)", () => {
      // beautiful-chat maps to 5 sub-keys; emit only 4 (bar-chart missing).
      // A missing mapped sub-row means the family is unverified, so D5 must
      // NOT be credited green — it returns status:null (no-data), matching
      // `isD5Green`'s `every(...)`. achievedDepth caps below 5; A1 renders
      // the unverified ladder gray.
      const live = mapOf([
        row(keyFor("e2e", "agno", "beautiful-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-toggle-theme"), "d5", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-pie-chart"), "d5", "green"),
        // beautiful-chat-bar-chart intentionally omitted.
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
      // Missing sub-row → no-data, NOT green and NOT red.
      expect(model.d5!.status).toBeNull();
      expect(model.achievedDepth).toBe(4);
      // Unverified ladder (D5 null), D6 absent → gray.
      expect(model.chipColor).toBe("gray");
    });

    it("still reports red when a present sub-row is red even if another is missing", () => {
      // A present red sub-row signals a real failure regardless of a missing
      // sibling — red dominates no-data.
      const live = mapOf([
        row(keyFor("e2e", "agno", "beautiful-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-toggle-theme"), "d5", "green"),
        row(keyFor("d5", "agno", "beautiful-chat-pie-chart"), "d5", "red"),
        // bar-chart missing; one present sub-row is red.
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
      expect(model.d5!.status).toBe("red");
      expect(model.achievedDepth).toBe(4);
      expect(model.chipColor).toBe("red");
    });
  });

  // ── No live data at all → D0 gray ──────────────────────────────────
  describe("no live data", () => {
    it("returns gray chip when D5 exists but no data (unverified ladder)", () => {
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
      // Contiguous-ladder: D5 has no data (status null), D6 absent →
      // unverified ladder → gray (no-data, not a failure).
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
      // D6-ceiling: no D5 and no D6 → gray
      expect(model.chipColor).toBe("gray");
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
      // agentic-chat is D6-mapped, so D6 EXISTS (mapped, unemitted) → ceiling 6.
      expect(model.ceilingDepth).toBe(6);
      // D6-ceiling: D4 red → gate failure → red
      expect(model.chipColor).toBe("red");
    });
  });

  // ── D6 ceiling model ────────────────────────────────────────────────
  describe("D6 ceiling model", () => {
    it("d6 field exists on the CellModel", () => {
      const model = buildCellModel(
        mapOf([]),
        wiredInput("agno", "agentic-chat"),
      );
      expect(model).toHaveProperty("d6");
    });

    it("D6 green → chipColor green", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d6!.exists).toBe(true);
      expect(model.d6!.status).toBe("green");
      expect(model.chipColor).toBe("green");
    });

    it("D5 green + D6 red → amber", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.status).toBe("green");
      expect(model.d6!.status).toBe("red");
      // D5 green but D6 not green → amber
      expect(model.chipColor).toBe("amber");
    });

    it("D5 green + D6 unemitted → amber", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.status).toBe("green");
      // agentic-chat is D6-mapped → D6 EXISTS but has no emitted data.
      expect(model.d6!.exists).toBe(true);
      expect(model.d6!.status).toBeNull();
      // D5 green but D6 not green (no-data) → amber
      expect(model.chipColor).toBe("amber");
    });

    it("D1-D4 gate failure → red override", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d3!.status).toBe("red");
      expect(model.d6!.status).toBe("green");
      // D3 red → gate failure overrides everything → red
      expect(model.chipColor).toBe("red");
    });

    it("no D5/D6 data → gray", () => {
      // Use a featureId with no D5 mapping, no D6 row
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.d5!.exists).toBe(false);
      expect(model.d6!.exists).toBe(false);
      expect(model.chipColor).toBe("gray");
    });

    it("D5 fail + D6 fail → red", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.status).toBe("red");
      expect(model.d6!.status).toBe("red");
      // Neither D5 nor D6 green, both exist → red
      expect(model.chipColor).toBe("red");
    });

    it("D5 red + D6 green → red (contiguous-ladder gate)", () => {
      // A red D5 below a green D6 must NOT paint green: the verification
      // ladder is broken at D5, so D6's per-cell pass is not trustworthy
      // evidence of this cell's health. Red wins.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.status).toBe("red");
      expect(model.d6!.status).toBe("green");
      expect(model.chipColor).toBe("red");
    });

    it("D5 null + D6 green → gray (unverified ladder)", () => {
      // A no-data D5 below a green D6 must NOT paint green: the ladder is
      // unverified at D5, so D6 cannot credit the cell. Treat as no-data.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.exists).toBe(true);
      expect(model.d5!.status).toBeNull();
      expect(model.d6!.status).toBe("green");
      expect(model.chipColor).toBe("gray");
    });

    it("D5 null + D6 red → red", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.status).toBeNull();
      expect(model.d6!.status).toBe("red");
      expect(model.chipColor).toBe("red");
    });

    it("D5 null + D6 unemitted → gray (no data)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.status).toBeNull();
      // agentic-chat is D6-mapped → D6 EXISTS but has no emitted data.
      expect(model.d6!.exists).toBe(true);
      expect(model.d6!.status).toBeNull();
      expect(model.chipColor).toBe("gray");
    });

    it("D6 uses per-cell keys, not the integration aggregate", () => {
      // D6 is keyed per-feature (d6:<slug>/<featureType>), NOT by slug only.
      // Two different features on the same slug resolve INDEPENDENT D6 rows;
      // the aggregate `d6:<slug>` (here red) is not consulted.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("e2e", "agno", "voice"), "e2e", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d5", "agno", "voice"), "d5", "green"),
        // Aggregate is red but must NOT be read…
        row(keyFor("d6", "agno"), "d6", "red"),
        // …per-cell rows differ between the two features.
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
        row(keyFor("d6", "agno", "voice"), "d6", "red"),
      ]);
      const modelA = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      const modelB = buildCellModel(live, wiredInput("agno", "voice"));
      // Each cell resolves its OWN per-cell row.
      expect(modelA.d6!.status).toBe("green");
      expect(modelB.d6!.status).toBe("red");
      // Distinct underlying rows (not a shared aggregate).
      expect(modelA.d6!.row?.key).toBe("d6:agno/agentic-chat");
      expect(modelB.d6!.row?.key).toBe("d6:agno/voice");
      expect(modelA.d6!.row).not.toBe(modelB.d6!.row);
    });

    it("ceilingDepth is 6 when D6 data exists", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.ceilingDepth).toBe(6);
      expect(model.achievedDepth).toBe(6);
    });
  });

  // ── D6 PER-CELL resolution (bug fix: was reading the integration
  //    aggregate `d6:<slug>`, painting genuinely-green cells red) ───────
  describe("D6 per-cell resolution (bug fix)", () => {
    it("resolves GREEN from the per-cell row even when the aggregate d6:<slug> is RED", () => {
      // The whole bug: aggregate `d6:agno` is RED (some OTHER cell failed),
      // but THIS cell's per-cell row `d6:agno/agentic-chat` is GREEN. The
      // cell must read its own per-cell row → green, NOT the red aggregate.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        // Aggregate is red (a different cell in the column failed)…
        row(keyFor("d6", "agno"), "d6", "red"),
        // …but this cell's per-cell parity row passed.
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d6!.exists).toBe(true);
      expect(model.d6!.status).toBe("green");
      // Resolved row is the PER-CELL row, not the aggregate.
      expect(model.d6!.row?.key).toBe("d6:agno/agentic-chat");
      // D5 green + D6 green → green chip.
      expect(model.chipColor).toBe("green");
    });

    it("resolves RED from the per-cell row even when the aggregate d6:<slug> is GREEN", () => {
      // Inverse: aggregate happens to be green but THIS cell's per-cell row
      // is red. The cell must surface its own red, not the green aggregate.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno"), "d6", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d6!.status).toBe("red");
      expect(model.d6!.row?.key).toBe("d6:agno/agentic-chat");
      // D5 green + per-cell D6 red → amber (D6 is above D5 in the ladder).
      expect(model.chipColor).toBe("amber");
    });

    it("two features on the same slug resolve DIFFERENT per-cell D6 rows", () => {
      // The aggregate model made every cell in a column identical. Per-cell
      // rows let a green cell sit next to a red cell in the same integration.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("e2e", "agno", "voice"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d5", "agno", "voice"), "d5", "green"),
        // aggregate red, but per-cell rows differ:
        row(keyFor("d6", "agno"), "d6", "red"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "red"),
        row(keyFor("d6", "agno", "voice"), "d6", "green"),
      ]);
      const modelChat = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
      );
      const modelVoice = buildCellModel(live, wiredInput("agno", "voice"));
      expect(modelChat.d6!.status).toBe("red");
      expect(modelVoice.d6!.status).toBe("green");
      // Distinct underlying rows — not the shared aggregate.
      expect(modelChat.d6!.row?.key).toBe("d6:agno/agentic-chat");
      expect(modelVoice.d6!.row?.key).toBe("d6:agno/voice");
      expect(modelChat.d6!.row).not.toBe(modelVoice.d6!.row);
      // Voice is fully green at D6; chat caps at amber on its red D6.
      expect(modelVoice.chipColor).toBe("green");
      expect(modelChat.chipColor).toBe("amber");
    });

    it("does NOT credit D6 green when one mapped per-cell sub-row is MISSING (strict, mirrors resolveD5)", () => {
      // beautiful-chat maps to 5 D6 sub-keys (same featureTypes as D5). Emit
      // only 4 per-cell D6 rows (bar-chart missing). A missing mapped sub-row
      // means the family is unverified → D6 status null (no-data), NOT green.
      // Mirrors resolveD5's strict missing-sub-row handling.
      const live = mapOf([
        row(keyFor("e2e", "agno", "beautiful-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        // All 5 D5 sub-rows green so the cell reaches D5.
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
        // D6: only 4 of 5 per-cell rows present (bar-chart omitted).
        row(keyFor("d6", "agno", "beautiful-chat-toggle-theme"), "d6", "green"),
        row(keyFor("d6", "agno", "beautiful-chat-pie-chart"), "d6", "green"),
        row(
          keyFor("d6", "agno", "beautiful-chat-search-flights"),
          "d6",
          "green",
        ),
        row(
          keyFor("d6", "agno", "beautiful-chat-schedule-meeting"),
          "d6",
          "green",
        ),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "beautiful-chat"));
      expect(model.d6!.exists).toBe(true);
      // Missing sub-row → no-data, NOT green and NOT red.
      expect(model.d6!.status).toBeNull();
      // D5 green but D6 unverified (no-data) → amber (ladder intact to D5).
      expect(model.chipColor).toBe("amber");
      expect(model.achievedDepth).toBe(5);
    });

    it("still reports D6 red when a present per-cell sub-row is red even if another is missing", () => {
      // A present red D6 sub-row signals a real parity failure regardless of a
      // missing sibling — red dominates no-data (mirrors resolveD5).
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
        // D6: one present sub-row is red, bar-chart missing.
        row(keyFor("d6", "agno", "beautiful-chat-toggle-theme"), "d6", "green"),
        row(keyFor("d6", "agno", "beautiful-chat-pie-chart"), "d6", "red"),
        row(
          keyFor("d6", "agno", "beautiful-chat-search-flights"),
          "d6",
          "green",
        ),
        row(
          keyFor("d6", "agno", "beautiful-chat-schedule-meeting"),
          "d6",
          "green",
        ),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "beautiful-chat"));
      expect(model.d6!.status).toBe("red");
      // D5 green + per-cell D6 red → amber.
      expect(model.chipColor).toBe("amber");
    });

    it("unmapped feature has no D6 test (exists:false)", () => {
      // A featureId absent from CATALOG_TO_D5_KEY has no per-cell D6 row,
      // so D6 does not exist for it — mirrors resolveD5's unmapped handling.
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        // A stray aggregate row must NOT be picked up for the unmapped cell.
        row(keyFor("d6", "agno"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.d6!.exists).toBe(false);
    });
  });

  // ── isRegression: achievedDepth below ceilingDepth ─────────────────
  describe("isRegression", () => {
    it("is true when achievedDepth < ceilingDepth (D3 red, tests exist)", () => {
      // D3 red → achievedDepth=0; D3 exists → ceilingDepth=3 → regression.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.achievedDepth).toBe(0);
      expect(model.ceilingDepth).toBe(3);
      expect(model.isRegression).toBe(true);
    });

    it("is false when achievedDepth === ceilingDepth (cell at its ceiling)", () => {
      // D3 green, no D4/D5 mapped → achieved=3, ceiling=3 → no regression.
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.achievedDepth).toBe(3);
      expect(model.ceilingDepth).toBe(3);
      expect(model.isRegression).toBe(false);
    });

    it("is false when ceilingDepth === 0 (no tests exist at all)", () => {
      const model = buildCellModel(
        mapOf([]),
        wiredInput("agno", "no-d5-feature"),
      );
      expect(model.ceilingDepth).toBe(0);
      expect(model.isRegression).toBe(false);
    });

    it("is false for unsupported and not-wired cells", () => {
      const unsupported = buildCellModel(mapOf([]), {
        slug: "agno",
        featureId: "agentic-chat",
        isSupported: false,
        isWired: false,
      });
      expect(unsupported.isRegression).toBe(false);
      const notWired = buildCellModel(mapOf([]), {
        slug: "agno",
        featureId: "agentic-chat",
        isSupported: true,
        isWired: false,
      });
      expect(notWired.isRegression).toBe(false);
    });

    // ── refinement (unification C): the next rung above achievedDepth must
    //    have EMITTED data (exists && status !== null) for a cell to count
    //    as a regression. A mapped-but-unemitted D5 (status === null) is
    //    no-data, not a slide-back. ──
    it("is FALSE when the next rung (D5) is mapped but has no emitted data", () => {
      // D3 green + D4 green, D5 mapped but NO d5 rows emitted →
      // achieved=4, d5.exists=true but d5.status===null. (ceiling is 6 since
      // agentic-chat is also D6-mapped.) The next rung above achieved (D5)
      // has no emitted data → NOT a regression.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.achievedDepth).toBe(4);
      expect(model.ceilingDepth).toBe(6);
      expect(model.d5?.exists).toBe(true);
      expect(model.d5?.status).toBeNull();
      expect(model.isRegression).toBe(false);
    });

    it("is TRUE when the next rung (D5) is below ceiling AND emitted red data", () => {
      // D3 green + D4 green + D5 red → achieved=4, and d5 has emitted
      // (status==='red'). (ceiling is 6 since agentic-chat is also D6-mapped.)
      // A real slide-back at the next rung → regression.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.achievedDepth).toBe(4);
      expect(model.ceilingDepth).toBe(6);
      expect(model.d5?.status).toBe("red");
      expect(model.isRegression).toBe(true);
    });
  });

  // ── e2e staleness downgrade (false-green D3 bug) ────────────────────
  // When the e2e driver stops writing `e2e:<slug>/<feature>` rows, the
  // last green row freezes and the depth ladder reads it as healthy → a
  // false-green D3 that masks a dead probe pipeline. A green e2e row older
  // than the staleness window must be downgraded to degraded (amber).
  describe("e2e staleness downgrade", () => {
    const NOW = Date.parse("2026-05-30T12:00:00Z");

    function e2eRowAtAge(ageMs: number, state: State = "green") {
      const observedAt = new Date(NOW - ageMs).toISOString();
      return row(keyFor("e2e", "agno", "agentic-chat"), "e2e", state, {
        observed_at: observedAt,
        transitioned_at: observedAt,
      });
    }

    it("downgrades a stale green e2e row to amber instead of green", () => {
      const live = mapOf([
        // e2e last observed well past the staleness window.
        e2eRowAtAge(E2E_STALE_AFTER_MS + 60 * 60 * 1000, "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      // Stale green must NOT present as a healthy D3.
      expect(model.d3?.status).toBe("amber");
      // A stale-amber D3 fails the D1-D4 gate → chip is red, not green.
      expect(model.chipColor).not.toBe("green");
      // achievedDepth must not credit D3 when the e2e signal is stale.
      expect(model.achievedDepth).toBe(0);
    });

    it("keeps a fresh green e2e row green", () => {
      const live = mapOf([
        e2eRowAtAge(60 * 1000, "green"), // observed 1 min ago — fresh
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d3?.status).toBe("green");
      // Only D3 (e2e) is green here, no D4 row → achievedDepth caps at 3.
      expect(model.achievedDepth).toBe(3);
    });

    it("leaves a stale RED e2e row red (staleness only downgrades green)", () => {
      const live = mapOf([
        e2eRowAtAge(E2E_STALE_AFTER_MS + 60 * 60 * 1000, "red"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d3?.status).toBe("red");
    });
  });

  // ── D5/D6 staleness downgrade (same false-green mode, one dimension up) ──
  // A frozen-green D5/D6 row from a stalled driver must be downgraded the
  // same way D3 is, so it no longer credits the depth ladder / ceiling.
  describe("D5/D6 staleness downgrade", () => {
    const NOW = Date.parse("2026-05-30T12:00:00Z");

    function rowAtAge(
      key: string,
      dimension: string,
      ageMs: number,
      state: State = "green",
    ) {
      const observedAt = new Date(NOW - ageMs).toISOString();
      return row(key, dimension, state, {
        observed_at: observedAt,
        transitioned_at: observedAt,
      });
    }

    const STALE = E2E_STALE_AFTER_MS + 60 * 60 * 1000;
    const FRESH = 60 * 1000;

    it("downgrades a stale green D5 row to amber (no longer credits D5/ceiling)", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", STALE, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      // Stale green D5 must NOT present as a healthy D5.
      expect(model.d5?.status).toBe("amber");
      // Depth ladder must not credit D5 when the signal is stale.
      expect(model.achievedDepth).toBe(4);
      // Chip: D5 not green, D6 absent → red (no longer amber-on-green-D5).
      expect(model.chipColor).toBe("red");
    });

    it("keeps a fresh green D5 row green", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", FRESH, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d5?.status).toBe("green");
      expect(model.achievedDepth).toBe(5);
      // D5 green but no D6 → amber.
      expect(model.chipColor).toBe("amber");
    });

    it("downgrades a stale green D6 row to amber (no longer credits D6/green chip)", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", FRESH, "green"),
        rowAtAge(keyFor("d6", "agno", "agentic-chat"), "d6", STALE, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      // Stale green D6 must NOT present as a healthy D6.
      expect(model.d6?.status).toBe("amber");
      // Depth ladder must not credit D6 when the signal is stale.
      expect(model.achievedDepth).toBe(5);
      // D5 green but D6 not green → amber, not green.
      expect(model.chipColor).toBe("amber");
    });

    it("keeps a fresh green D6 row green", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", FRESH, "green"),
        rowAtAge(keyFor("d6", "agno", "agentic-chat"), "d6", FRESH, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d6?.status).toBe("green");
      expect(model.achievedDepth).toBe(6);
      expect(model.chipColor).toBe("green");
    });

    it("leaves a stale RED D5 row red (staleness only downgrades green)", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", STALE, "red"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d5?.status).toBe("red");
    });

    // ── Multi-key D5: stale-green sub-row must not be masked by the fold ──
    // `resolveD5` reduces sub-keys to a "worst" row, but green is the LOWEST
    // rank — so among all-green sub-rows a fresh-green can win the tie. If
    // staleness were checked only on the post-fold winner, a stale-green
    // sibling would be silently masked → false-green. The downgrade must be
    // per-row (before the fold), so ANY stale-green sub-row forces amber,
    // independent of CATALOG_TO_D5_KEY ordering.
    describe("multi-key D5: one stale-green + one fresh-green sub-row", () => {
      // beautiful-chat maps to 5 D5 sub-keys (see CATALOG_TO_D5_KEY). We make
      // exactly one stale-green and the rest fresh-green so the only signal
      // is the stale sibling — which must downgrade the whole family.
      const STALE_SUBKEY = "beautiful-chat-bar-chart";
      const FRESH_SUBKEYS = [
        "beautiful-chat-toggle-theme",
        "beautiful-chat-pie-chart",
        "beautiful-chat-search-flights",
        "beautiful-chat-schedule-meeting",
      ];

      function buildRows(staleFirst: boolean): StatusRow[] {
        const base = [
          rowAtAge(
            keyFor("e2e", "agno", "beautiful-chat"),
            "e2e",
            FRESH,
            "green",
          ),
          rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        ];
        const staleRow = rowAtAge(
          keyFor("d5", "agno", STALE_SUBKEY),
          "d5",
          STALE,
          "green",
        );
        const freshRows = FRESH_SUBKEYS.map((sk) =>
          rowAtAge(keyFor("d5", "agno", sk), "d5", FRESH, "green"),
        );
        // Vary insertion order to prove the result does not depend on which
        // green sub-row the fold encounters first.
        return staleFirst
          ? [...base, staleRow, ...freshRows]
          : [...base, ...freshRows, staleRow];
      }

      it("downgrades to amber when the stale sub-row is folded FIRST", () => {
        const model = buildCellModel(
          mapOf(buildRows(true)),
          wiredInput("agno", "beautiful-chat"),
          NOW,
        );
        // Stale-green sibling must force the family off green.
        expect(model.d5?.status).toBe("amber");
        // Depth ladder must not credit D5.
        expect(model.achievedDepth).toBe(4);
        // D5 not green, D6 absent → red.
        expect(model.chipColor).toBe("red");
      });

      it("downgrades to amber when the stale sub-row is folded LAST", () => {
        const model = buildCellModel(
          mapOf(buildRows(false)),
          wiredInput("agno", "beautiful-chat"),
          NOW,
        );
        expect(model.d5?.status).toBe("amber");
        expect(model.achievedDepth).toBe(4);
        expect(model.chipColor).toBe("red");
      });
    });
  });

  // ── D4 staleness downgrade (per-driver window) ─────────────────────
  // The chat/tools drivers write `chat:<slug>`/`tools:<slug>` rows on their
  // own cadence. A frozen-green D4 row from a stalled driver must downgrade
  // to amber the same way D3/D5/D6 do, using the D4-specific window.
  describe("D4 staleness downgrade", () => {
    const NOW = Date.parse("2026-05-30T12:00:00Z");

    function rowAtAge(
      key: string,
      dimension: string,
      ageMs: number,
      state: State = "green",
    ) {
      const observedAt = new Date(NOW - ageMs).toISOString();
      return row(key, dimension, state, {
        observed_at: observedAt,
        transitioned_at: observedAt,
      });
    }

    const STALE = D4_STALE_AFTER_MS + 60 * 1000;
    const FRESH = 60 * 1000;

    it("downgrades a stale green D4 (chat) row to amber", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", STALE, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", FRESH, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      // Stale green D4 must NOT present as healthy.
      expect(model.d4?.status).toBe("amber");
      // D4 stale-amber fails the gate → chain caps at D3.
      expect(model.achievedDepth).toBe(3);
      // Gate fails (D4 not green) → red.
      expect(model.chipColor).toBe("red");
    });

    it("keeps a fresh green D4 row green", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", FRESH, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d4?.status).toBe("green");
      expect(model.achievedDepth).toBe(5);
    });

    it("leaves a stale RED D4 row red (staleness only downgrades green)", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", STALE, "red"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d4?.status).toBe("red");
    });
  });

  // ── Effective-row invariant: .row.state must AGREE with .status ─────
  // The returned `.row` must be the EFFECTIVE (stale-downgraded) row, so
  // `stateToTestStatus(.row.state) === .status`. This mirrors the invariant
  // in live-status.ts `buildBadge`, whose returned `.row` is the effective
  // row (`{ ...row, state: "degraded" }`). Previously resolveD4/D5/D6 returned
  // the RAW status row while `.status` was derived from the stale-downgraded
  // effective state, so a stale-green fold reported `.row.state === "green"`
  // but `.status === "amber"` — an internal contradiction.
  describe("effective-row invariant (.row.state agrees with .status)", () => {
    const NOW = Date.parse("2026-05-30T12:00:00Z");

    function rowAtAge(
      key: string,
      dimension: string,
      ageMs: number,
      state: State = "green",
    ) {
      const observedAt = new Date(NOW - ageMs).toISOString();
      return row(key, dimension, state, {
        observed_at: observedAt,
        transitioned_at: observedAt,
      });
    }

    const E2E_STALE = E2E_STALE_AFTER_MS + 60 * 60 * 1000;
    const D4_STALE = D4_STALE_AFTER_MS + 60 * 1000;
    const FRESH = 60 * 1000;

    it("D4: stale-green folds to amber and .row.state matches .status", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", D4_STALE, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d4?.status).toBe("amber");
      // The effective row must reflect the downgrade, not the raw green state.
      expect(model.d4?.row?.state).toBe("degraded");
    });

    it("D5: stale-green folds to amber and .row.state matches .status", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        rowAtAge(
          keyFor("d5", "agno", "agentic-chat"),
          "d5",
          E2E_STALE,
          "green",
        ),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d5?.status).toBe("amber");
      expect(model.d5?.row?.state).toBe("degraded");
    });

    it("D6: stale-green folds to amber and .row.state matches .status", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", FRESH, "green"),
        rowAtAge(
          keyFor("d6", "agno", "agentic-chat"),
          "d6",
          E2E_STALE,
          "green",
        ),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d6?.status).toBe("amber");
      expect(model.d6?.row?.state).toBe("degraded");
    });

    it("D5: fresh-green keeps the raw row (no spurious downgrade)", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", FRESH, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d5?.status).toBe("green");
      // Fresh green is not downgraded: .row.state stays green.
      expect(model.d5?.row?.state).toBe("green");
    });
  });

  // ── CHARACTERIZATION: buildCellModel does NOT read health:/agent: rows ──
  // resolveD3 credits D3 from the `e2e:<slug>/<feature>` row ALONE. The
  // implicit "D1/D2 gate" (a failing liveness probe drags e2e down) is a
  // PRODUCER-SIDE invariant: the e2e driver is expected not to emit green
  // when health/agent are red. buildCellModel itself never consults the
  // health:/agent: rows, so a fresh-green e2e row credits D3 even when a
  // health/agent row is red or absent. This test PINS that documented
  // current behavior; it does NOT assert a new requirement.
  describe("D1/D2 gate is a producer invariant (characterization)", () => {
    it("credits D3 from a fresh-green e2e row even when health: is RED", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
        // A red liveness/agent row is present but buildCellModel ignores it.
        row(keyFor("health", "agno"), "health", "red"),
        row(keyFor("agent", "agno"), "agent", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      // D3 is credited from e2e alone — health/agent rows are not consulted.
      expect(model.d3!.status).toBe("green");
      expect(model.achievedDepth).toBe(3);
    });

    it("credits D3 from a fresh-green e2e row even when health:/agent: are ABSENT", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.d3!.status).toBe("green");
      expect(model.achievedDepth).toBe(3);
    });
  });

  // ── d6Effective: ladder-gated D6 status (D6 never green if D5 fails) ──
  describe("d6Effective ladder-gating", () => {
    it("blocks (null) D6 when D5 is RED even though the raw D6 row is GREEN", () => {
      // The exact bug: D5 red but D6 emitted green in isolation. The raw
      // per-dimension d6.status is green, but the top-of-ladder claim is
      // broken below D6, so d6Effective must NOT be green (and not a false
      // red — the CV badge already shows the D5 failure).
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      // Raw per-dimension D6 is green (diagnostic), but the ladder is broken.
      expect(model.d6!.status).toBe("green");
      // Ladder-gated D6 is blocked → null, NOT green, NOT red.
      expect(model.d6Effective).toBeNull();
      // Chip stays red (D5-broken ladder) and badges below stay per-dimension.
      expect(model.chipColor).toBe("red");
      expect(model.d5!.status).toBe("red");
      expect(model.achievedDepth).toBe(4);
    });

    it("greens d6Effective only on a FULLY-INTACT ladder (D5 green + D6 green)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d6Effective).toBe("green");
      expect(model.achievedDepth).toBe(6);
      expect(model.chipColor).toBe("green");
    });

    it("passes through a genuine D6 RED when the ladder is intact through D5", () => {
      // D5 green, D6 red → ladder intact below D6, the D6 failure is real.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d6Effective).toBe("red");
      expect(model.chipColor).toBe("amber");
    });

    it("blocks (null) D6 when the D1-D4 gate fails, regardless of raw D6", () => {
      const live = mapOf([
        // D3 red → gate fails; D6 raw green must be suppressed.
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d6Effective).toBeNull();
      expect(model.chipColor).toBe("red");
    });

    it("blocks (null) D6 when D5 is unverified (no-data) even if raw D6 is green", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        // D5 mapped but no row emitted → status null (unverified).
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.status).toBeNull();
      expect(model.d6Effective).toBeNull();
      expect(model.chipColor).toBe("gray");
    });
  });
});
