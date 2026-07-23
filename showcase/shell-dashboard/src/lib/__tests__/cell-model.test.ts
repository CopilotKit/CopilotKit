import { describe, it, expect } from "vitest";
import {
  buildCellModel,
  E2E_STALE_AFTER_MS,
  D4_STALE_AFTER_MS,
  LIVENESS_STALE_AFTER_MS,
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

  // ── G3e(i): shared singletons must be frozen ────────────────────────
  // `UNSUPPORTED` and `NOT_WIRED_LEVEL` are module-level singletons returned
  // by reference to every caller — one consumer mutating its "own" cell model
  // would corrupt every other unsupported/not-wired cell. Freeze them.
  describe("shared singleton immutability (G3e)", () => {
    it("the unsupported CellModel singleton is frozen", () => {
      const model = buildCellModel(mapOf([]), {
        slug: "agno",
        featureId: "agentic-chat",
        isSupported: false,
        isWired: false,
      });
      expect(Object.isFrozen(model)).toBe(true);
    });

    it("the shared NOT_WIRED_LEVEL TestLevel is frozen", () => {
      const model = buildCellModel(mapOf([]), {
        slug: "agno",
        featureId: "agentic-chat",
        isSupported: true,
        isWired: false,
      });
      expect(Object.isFrozen(model.d3)).toBe(true);
      expect(Object.isFrozen(model.d6)).toBe(true);
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
      // Use a featureId with no CATALOG_TO_D5_KEY mapping → structural ceiling 4
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.d3!.exists).toBe(true);
      expect(model.d3!.status).toBe("green");
      expect(model.achievedDepth).toBe(3);
      // §4b: ceilingDepth is STRUCTURAL — a D5-unmapped feature reaches D4 (4),
      // independent of which probe rows exist.
      expect(model.ceilingDepth).toBe(4);
      // A3/§4c: D4 is an incomplete top for a D5-unmapped feature (not a green
      // "complete verification level"), and D4 itself is absent here → gray.
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
      // §4b: ceilingDepth is STRUCTURAL — a D5-mapped feature reaches D6 (6),
      // regardless of which probe rows have arrived.
      expect(model.ceilingDepth).toBe(6);
      // Contiguous-ladder: D4 absent breaks the ladder above D3 → gray
      // (I1: unverified, not a failure).
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

  // ── Absent D3/D4 family → unverified gray, never green (CF7-F3 #2) ──
  describe("absent D3/D4 family collapses to unverified gray (CF7-F3 #2)", () => {
    it("only-D5/D6-green (no e2e/chat/tools rows at all) renders GRAY, not green", () => {
      // The D1-D4 gate fires only on d3.exists/d4.exists, so a cell with ONLY
      // green D5/D6 rows used to slip past it and render a green chip + green
      // d6Effective with achievedDepth=0/ceilingDepth=0 — contradicting the
      // strictness doctrine (a PRESENT-but-null D4 grays; D5-no-data grays the
      // ladder; an ABSENT lower ladder must not be weaker than a present
      // unverified one).
      const live = mapOf([
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d3!.exists).toBe(false);
      expect(model.d4!.exists).toBe(false);
      expect(model.achievedDepth).toBe(0);
      // §4b: ceilingDepth is STRUCTURAL (D5-mapped feature → 6), not
      // probe-existence — it no longer collapses to 0 when no rows exist.
      expect(model.ceilingDepth).toBe(6);
      // I1: absent D3 breaks the ladder at the base; green D5/D6 above the gap
      // are not contiguous and do not credit green → gray, D6 claim blocked.
      expect(model.chipColor).toBe("gray");
      expect(model.d6Effective).toBeNull();
      expect(model.surfaceState).toBe("gray");
    });

    it("with D3/D4 green the full-green ladder stays GREEN (unchanged)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("green");
      expect(model.d6Effective).toBe("green");
    });

    it("absent D3/D4 + red D6 → GRAY (red above an absent gap is not contiguous)", () => {
      const live = mapOf([
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      // I1/§4c: the walk stops at the first absent rung (D3); the red D6 sits
      // ABOVE the gap, is not contiguous, and does not surface red → gray
      // unverified. ("red dominates" is preserved only for a red on a
      // CONTIGUOUS existing rung — spec §4c line 440.)
      expect(model.chipColor).toBe("gray");
      expect(model.d6Effective).toBeNull();
    });

    it("absent D3/D4 + red D5 → GRAY (red above an absent gap is not contiguous)", () => {
      const live = mapOf([
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      // I1/§4c: absent D3/D4 stops the walk; the red D5 above the gap is
      // excluded → gray unverified.
      expect(model.chipColor).toBe("gray");
      expect(model.d6Effective).toBeNull();
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
      // §4b: structural ceiling for a D5-unmapped feature is 4 (D1–D4).
      expect(model.ceilingDepth).toBe(4);
      // D3 (a contiguous existing rung) is a fresh red → red.
      expect(model.chipColor).toBe("red");
    });
  });

  // ── Gray vs red: no tests at all vs tests-exist-but-all-fail ────────
  describe("gray vs red chip for achievedDepth=0", () => {
    it("gray when no rows exist at all (no failing contiguous rung)", () => {
      const model = buildCellModel(
        mapOf([]),
        wiredInput("agno", "no-d5-feature"),
      );
      // §4b: ceiling is now STRUCTURAL (4), even with zero rows; the
      // gray-vs-red distinction is "no failing contiguous rung → gray".
      expect(model.ceilingDepth).toBe(4);
      expect(model.achievedDepth).toBe(0);
      expect(model.chipColor).toBe("gray");
    });

    it("red when a contiguous rung fails (D3 red)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.ceilingDepth).toBe(4);
      expect(model.achievedDepth).toBe(0);
      expect(model.chipColor).toBe("red");
    });
  });

  // ── D4 via tools instead of chat ────────────────────────────────────
  describe("D4 via tools row", () => {
    it("does NOT credit D4 green from tools:<slug> alone when chat is absent (G2f strictness)", () => {
      // `chat:<slug>` is UNCONDITIONAL on the producer side (the D4 driver
      // writes the L3 round-trip row for every probed integration), so a
      // tools-only green fold means the always-expected sibling is missing —
      // an unverified family that must collapse to no-data, mirroring the
      // D5/D6 missing-mapped-sub-row strictness. (A green CHAT row with
      // tools missing still credits D4 — tools is producer-conditional.)
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d4!.exists).toBe(true);
      expect(model.d4!.status).toBeNull();
      expect(model.d4!.row).toBeNull();
      expect(model.achievedDepth).toBe(3);
    });

    it("a RED tools row still surfaces when chat is absent (red dominates no-data)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("tools", "agno"), "tools", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d4!.status).toBe("red");
      expect(model.d4!.row!.dimension).toBe("tools");
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

    it("missing-chat collapse renders the GRAY no-data chip, not red (unverified ≠ failed)", () => {
      // The tools-only collapse is documented as the no-data outcome
      // ("mirroring the D5/D6 missing-mapped-sub-row strictness") — D5/D6's
      // analogous collapse renders a GRAY chip, so a not-yet-emitted chat row
      // must read as unverified (gray), NOT as a D1-D4 gate hard-failure (red).
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d4!.status).toBeNull();
      expect(model.chipColor).toBe("gray");
      expect(model.surfaceState).toBe("gray");
      // The D6 claim stays blocked while the ladder below it is unverified.
      expect(model.d6Effective).toBeNull();
    });

    it("a present RED chat row folds D4 to red; the chip is a first-strike amber (§C)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      // The D4 rung still folds to red (a present non-green chat row)…
      expect(model.d4!.status).toBe("red");
      // …but §C item 6 de-amplifies a first D4 strike (fail_count 1 < 2) to a
      // one-tick amber; a second consecutive red crosses the threshold → red.
      expect(model.chipColor).toBe("amber");
    });

    it("missing-chat no-data does NOT mask a present red D5 (red dominates no-data)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d4!.status).toBeNull();
      expect(model.chipColor).toBe("red");
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
      // §4b: ceiling is STRUCTURAL (D5-mapped → 6), independent of rows.
      expect(model.ceilingDepth).toBe(6);
      expect(model.achievedDepth).toBe(0);
      // Absent D3 → unverified ladder → gray (no-data, not a failure).
      expect(model.chipColor).toBe("gray");
    });

    it("returns structural ceilingDepth even when no tests exist at all", () => {
      const model = buildCellModel(
        mapOf([]),
        wiredInput("agno", "no-d5-feature"),
      );
      // §4b: a D5-unmapped feature has structural ceiling 4 (not 0).
      expect(model.ceilingDepth).toBe(4);
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
    it("ceilingDepth reflects the structural reachability, not existing levels", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      // §4b: structural ceiling for a D5-unmapped feature is 4.
      expect(model.ceilingDepth).toBe(4);
      expect(model.achievedDepth).toBe(3);
      // A3: D4 is an incomplete top for a D5-unmapped feature and is absent
      // here → gray.
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
      // §C item 6: a first D4 strike (fail_count 1 < 2) de-amplifies to amber
      // (transient), not red; a second consecutive red would cross the
      // threshold and go red.
      expect(model.chipColor).toBe("amber");
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

    it("D5 null + D6 red → GRAY (D6 red above an unverified D5 is not contiguous)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.status).toBeNull();
      expect(model.d6!.status).toBe("red");
      // I1/§4c: D5 has no data (unverified) → the ladder is not contiguous
      // through D5, so the red D6 above it is excluded and the D6 claim is
      // blocked (d6Effective null) → gray, not red.
      expect(model.chipColor).toBe("gray");
      expect(model.d6Effective).toBeNull();
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

    it("END-TO-END: dashboard surfaces a fleet d6 result from the worker's emitted keys (d6:<slug> aggregate + d6:<slug>/<ft> per-cell)", () => {
      // VERIFICATION of the worker→dashboard contract: the fleet worker emits
      // the d6 aggregate at `d6:<slug>` AND per-cell rows at `d6:<slug>/<ft>`
      // (NOT `e2e_d6:<slug>`). This pins that the dashboard's read side actually
      // consumes EXACTLY those keys — a green per-cell row drives the green chip,
      // and a comm error mirrored onto the aggregate row surfaces "unreachable".
      const slug = "langgraph-python";
      const ft = "agentic-chat";

      // 1) Healthy fleet result: full ladder green, per-cell d6 green, aggregate
      //    green. The cell must read its OWN per-cell d6:<slug>/<ft> row green.
      const healthy = mapOf([
        row(keyFor("e2e", slug, ft), "e2e", "green"),
        row(keyFor("chat", slug), "chat", "green"),
        row(keyFor("tools", slug), "tools", "green"),
        row(keyFor("d5", slug, ft), "d5", "green"),
        row(keyFor("d6", slug), "d6", "green"), // aggregate (worker emit)
        row(keyFor("d6", slug, ft), "d6", "green"), // per-cell (worker emit)
      ]);
      const healthyModel = buildCellModel(healthy, wiredInput(slug, ft));
      expect(healthyModel.d6!.exists).toBe(true);
      expect(healthyModel.d6!.status).toBe("green");
      expect(healthyModel.d6!.row?.key).toBe(`d6:${slug}/${ft}`);
      expect(healthyModel.achievedDepth).toBe(6);
      expect(healthyModel.chipColor).toBe("green");
      expect(healthyModel.surfaceState).toBe("green");
      expect(healthyModel.commError).toBeUndefined();

      // 2) Comm-error fleet result (worker-death): the worker had no driver run,
      //    so the PoolCommError is mirrored onto the AGGREGATE row `d6:<slug>`
      //    (per the contract's `aggregateKey` fallback). The dashboard must read
      //    that aggregate row and surface the "unreachable" overlay.
      const commErrored = mapOf([
        row(keyFor("e2e", slug, ft), "e2e", "green"),
        row(keyFor("chat", slug), "chat", "green"),
        row(keyFor("tools", slug), "tools", "green"),
        row(keyFor("d5", slug, ft), "d5", "green"),
        row(keyFor("d6", slug, ft), "d6", "green"),
        row(keyFor("d6", slug), "d6", "green", {
          signal: {
            __fleetCommError: {
              kind: "worker-crashed-mid-job",
              message: "lease expired with no terminal report",
              workerId: "fleet-worker-3",
              observedAt: FRESH_OBSERVED_AT,
            },
          },
        }),
      ]);
      const commModel = buildCellModel(commErrored, wiredInput(slug, ft));
      expect(commModel.surfaceState).toBe("unreachable");
      expect(commModel.commError?.kind).toBe("worker-crashed-mid-job");
      expect(commModel.commError?.workerId).toBe("fleet-worker-3");
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
      // D3 red → achievedDepth=0; §4b structural ceiling 6 (D5-mapped). The
      // next contiguous rung above achieved (D3, skipping absent D1/D2) is a
      // genuine FAIL_FRESH → regression.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.achievedDepth).toBe(0);
      expect(model.ceilingDepth).toBe(6);
      expect(model.isRegression).toBe(true);
    });

    it("is false when achieved < ceiling but the next rung is not a genuine fail", () => {
      // D3 green → achieved 3; §4b structural ceiling 4 (D5-unmapped). The next
      // rung (D4) is ABSENT, not a FAIL_FRESH → no regression.
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      expect(model.achievedDepth).toBe(3);
      expect(model.ceilingDepth).toBe(4);
      expect(model.isRegression).toBe(false);
    });

    it("is false when no rows exist (nothing achieved, no genuine fail above)", () => {
      const model = buildCellModel(
        mapOf([]),
        wiredInput("agno", "no-d5-feature"),
      );
      // §4b: structural ceiling 4 even with zero rows; achieved 0 and the next
      // rung is ABSENT (not FAIL_FRESH) → no regression.
      expect(model.ceilingDepth).toBe(4);
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
      // I2/§4c: a STALE_DEGRADED rung folds to amber ("re-sweep pending"),
      // NOT red — staleness is not a failure.
      expect(model.chipColor).toBe("amber");
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
        // I2/§4c: STALE_DEGRADED D5 folds to amber ("re-sweep pending"), not red.
        expect(model.chipColor).toBe("amber");
      });

      it("downgrades to amber when the stale sub-row is folded LAST", () => {
        const model = buildCellModel(
          mapOf(buildRows(false)),
          wiredInput("agno", "beautiful-chat"),
          NOW,
        );
        expect(model.d5?.status).toBe("amber");
        expect(model.achievedDepth).toBe(4);
        // I2/§4c: STALE_DEGRADED D5 folds to amber, not red.
        expect(model.chipColor).toBe("amber");
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
      // D4 stale-amber caps the ladder at D3.
      expect(model.achievedDepth).toBe(3);
      // I2/§4c: STALE_DEGRADED D4 folds to amber ("re-sweep pending"), not red.
      expect(model.chipColor).toBe("amber");
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

  // ── Stale-green downgrade: verdict in .status, .row is the raw winner ────
  // The unified engine folds a stale-green rung to `.status === "amber"` (the
  // authoritative verdict) and surfaces the RAW contributing (winner) row as
  // `.row` — its `.state` stays "green" and `.fail_count` stays 0, because the
  // row genuinely ran green and is merely stale. No consumer reads `.row.state`
  // (they read `.row.fail_count`/`.signal`/`.id`); `d0-gone-monitor` in fact
  // RELIES on a stale-green winner reading "green" (fail_count 0) so it is NOT
  // mistimed as an outage onset (§7 I2 "degraded ≠ failed"). The old synthesized
  // `.row.state === "degraded"` is retired.
  describe("stale-green downgrade: .status folds to amber, .row is the raw winner", () => {
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

    it("D3: stale-green folds .status to amber; .row is the raw green winner (G3c)", () => {
      const live = mapOf([
        rowAtAge(
          keyFor("e2e", "agno", "agentic-chat"),
          "e2e",
          E2E_STALE,
          "green",
        ),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d3?.status).toBe("amber");
      // The winner row is the raw stale-green row — state "green", no failures.
      expect(model.d3?.row?.state).toBe("green");
      expect(model.d3?.row?.fail_count).toBe(0);
    });

    it("D3: fresh-green keeps the raw row (no spurious downgrade)", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.d3?.status).toBe("green");
      expect(model.d3?.row?.state).toBe("green");
    });

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
      // Verdict is in .status; .row is the raw green winner (fail_count 0).
      expect(model.d4?.row?.state).toBe("green");
      expect(model.d4?.row?.fail_count).toBe(0);
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
      // Verdict is in .status; .row is the raw green winner (fail_count 0).
      expect(model.d5?.row?.state).toBe("green");
      expect(model.d5?.row?.fail_count).toBe(0);
    });

    it("D6: stale-green folds to amber and .row is the raw green winner", () => {
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
      // Verdict is in .status; .row is the raw green winner (fail_count 0).
      expect(model.d6?.row?.state).toBe("green");
      expect(model.d6?.row?.fail_count).toBe(0);
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

  // ── G3a: rank-based anyMissing collapse (mirror of live-status Fix A2) ──
  // resolveD5/resolveD6 collapse a present green/degraded fold to no-data
  // when a mapped sub-row is missing. That collapse guard must be RANK-based,
  // not the literal `worstState !== "red"`: `worstState` is typed `State` but
  // can hold an out-of-vocabulary runtime value (e.g. "error" — the harness
  // no-data representation), which the A2 rank machinery deliberately ranks
  // ABOVE red. Literal equality matches neither, so exactly the state the
  // rank fold exists to surface was being collapsed to benign gray no-data.
  // Mirrors live-status.test.ts "missing sub-row + out-of-vocab sub-row
  // SURFACES" for resolveD5Row/resolveD6Row.
  describe("rank-based anyMissing collapse (G3a)", () => {
    const OUT_OF_VOCAB = "error" as unknown as State;

    it("d5: missing sub-row + out-of-vocab sub-row SURFACES the row, not the no-data collapse", () => {
      // beautiful-chat maps to 5 d5 sub-keys; emit ONE row carrying "error"
      // (4 siblings missing). The literal `!== "red"` guard collapsed this to
      // { status: null, row: null }; the rank guard must surface the row —
      // an unrecognized state out-ranks red and dominates no-data.
      const live = mapOf([
        row(
          keyFor("d5", "agno", "beautiful-chat-toggle-theme"),
          "d5",
          OUT_OF_VOCAB,
        ),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "beautiful-chat"));
      expect(model.d5!.exists).toBe(true);
      expect(model.d5!.row).not.toBeNull();
      expect(model.d5!.row?.key).toBe("d5:agno/beautiful-chat-toggle-theme");
    });

    it("d6: missing sub-row + out-of-vocab sub-row SURFACES the row, not the no-data collapse", () => {
      const live = mapOf([
        row(
          keyFor("d6", "agno", "beautiful-chat-pie-chart"),
          "d6",
          OUT_OF_VOCAB,
        ),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "beautiful-chat"));
      expect(model.d6!.exists).toBe(true);
      expect(model.d6!.row).not.toBeNull();
      expect(model.d6!.row?.key).toBe("d6:agno/beautiful-chat-pie-chart");
    });

    it("d5: missing sub-row + out-of-vocab sub-row yields a FAILING status, not no-data (G3b)", () => {
      // Follow-through of the rank fold: the surfaced out-of-vocab winner must
      // also MAP to a failing status — otherwise the collapse fix is undone
      // one step later by stateToTestStatus mapping the unknown state to null.
      const live = mapOf([
        row(
          keyFor("d5", "agno", "beautiful-chat-toggle-theme"),
          "d5",
          OUT_OF_VOCAB,
        ),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "beautiful-chat"));
      expect(model.d5!.status).toBe("red");
    });

    it("d5: missing sub-row + green fold still collapses to no-data (strict handling preserved)", () => {
      // The rank guard must NOT weaken the strict missing-sub-row rule: a
      // present green fold with a missing sibling stays no-data.
      const live = mapOf([
        row(keyFor("d5", "agno", "beautiful-chat-toggle-theme"), "d5", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "beautiful-chat"));
      expect(model.d5!.exists).toBe(true);
      expect(model.d5!.status).toBeNull();
      expect(model.d5!.row).toBeNull();
    });
  });

  // ── G3b: out-of-vocab states map to a FAILING status for D5/D6 ──────
  // `stateToTestStatus` mapped unknown runtime states (e.g. "error" — the
  // harness no-data representation) to `null`, swallowing the A2 rank-fold
  // winner one step AFTER the fold surfaced it: the D5/D6 chip/badge rendered
  // benign gray no-data while live-status's badge path renders the loud
  // "error" tone for the same row. D5/D6 must map an out-of-vocab state to a
  // failing ("red") status. D3/D4 keep the base mapping — their `null` is
  // rescued by the chip's D1-D4 gate check (exists && status !== "green" →
  // gate fails → red), pinned below.
  describe("out-of-vocab state → failing D5/D6 status (G3b)", () => {
    const OUT_OF_VOCAB = "error" as unknown as State;

    it("an 'error'-state D5 row yields status red and a red (not gray) chip", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", OUT_OF_VOCAB),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d5!.status).toBe("red");
      // Broken ladder at D5 → red chip; pre-fix this rendered gray (no-data).
      expect(model.chipColor).toBe("red");
      expect(model.achievedDepth).toBe(4);
    });

    it("an 'error'-state D6 row yields status red (passes through d6Effective on an intact ladder)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", OUT_OF_VOCAB),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d6!.status).toBe("red");
      // Ladder intact through D5 → the failing D6 surfaces on the badge/stat.
      expect(model.d6Effective).toBe("red");
      // D5 green + non-green D6 → amber chip (per the decision table).
      expect(model.chipColor).toBe("amber");
    });

    it("an 'error'-state D3 row folds to red status and reds the chip", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", OUT_OF_VOCAB),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      // Unified fold: an out-of-vocab state ranks above red (worst-wins), so
      // D3 folds directly to "red" — the two-path "status null but gate reds it"
      // collapses to a single authoritative red status.
      expect(model.d3!.status).toBe("red");
      // D3 (a contiguous existing rung) is a fresh red → red chip, achieved 0.
      expect(model.chipColor).toBe("red");
      expect(model.achievedDepth).toBe(0);
    });

    it("an 'error'-state D4 row folds to red status; the chip is a first-strike amber (never no-data gray)", () => {
      // D4's `null` means NO-DATA (missing-chat collapse → gray), so an
      // out-of-vocab D4 state maps to "red" via the fold — it must NOT hide
      // behind the no-data exclusion. The chip is amber (not gray) here because
      // §C de-amplifies a first D4 strike (fail_count 0 < 2); the key property
      // — an out-of-vocab D4 never reads as no-data gray — holds.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", OUT_OF_VOCAB),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.d4!.status).toBe("red");
      expect(model.chipColor).toBe("amber");
      expect(model.achievedDepth).toBe(3);
    });
  });

  // ── §F: buildCellModel reads health:/agent: rows as the D1/D2 liveness gate ──
  // The unified engine now consumes the health:/agent: rows: a PRESENT
  // fresh-red D1/D2 gates the cell (achieved 0, red), while an ABSENT or STALE
  // liveness row is NON-GATING (skipped — preserving the common cold-load /
  // undiscovered-service case). This absorbs the former producer-side "D1/D2
  // gate" invariant into the derivation (spec §F).
  describe("D1/D2 liveness gate (§F)", () => {
    it("a present fresh-RED health (D1) row gates the cell → achieved 0", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
        // A fresh-red liveness row now GATES the cell (§F).
        row(keyFor("health", "agno"), "health", "red"),
        row(keyFor("agent", "agno"), "agent", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      // The D3 rung itself still reads green from its e2e row…
      expect(model.d3!.status).toBe("green");
      // …but the present fresh-red D1 gates the ladder → achieved 0 (§F).
      expect(model.achievedDepth).toBe(0);
    });

    it("ABSENT health/agent is non-gating — a fresh-green e2e still credits D3", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "no-d5-feature"), "e2e", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "no-d5-feature"));
      // §F: absent D1/D2 is skipped (non-gating), so D3 is credited normally.
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
      // red — the 1P badge already shows the D5 failure).
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

  // ── REQ-B: pool comm-error → "unreachable" surface state ────────────
  describe("pool comm-error overlay (REQ-B)", () => {
    const COMM = {
      kind: "worker-unreachable" as const,
      message: "connect ECONNREFUSED",
      workerId: "worker-7",
      observedAt: FRESH_OBSERVED_AT,
    };
    const commSignal = { __fleetCommError: COMM };

    it("a row carrying __fleetCommError surfaces as unreachable, distinct from red", () => {
      const live = mapOf([
        // Last-known probe colour stays green; the comm error rides on the row.
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green", {
          signal: commSignal,
        }),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.surfaceState).toBe("unreachable");
      // The probe colour (chipColor) is preserved — comm error is an OVERLAY,
      // not a recolour. The last-known result stays visible underneath.
      expect(model.chipColor).toBe("green");
      // The decoded comm error names the kind + worker for the tooltip.
      expect(model.commError?.kind).toBe("worker-unreachable");
      expect(model.commError?.workerId).toBe("worker-7");
    });

    it("a normal red row (no comm error) is unaffected — surfaceState is red, not unreachable", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("red");
      expect(model.surfaceState).toBe("red");
      expect(model.commError).toBeUndefined();
    });

    it("decodes a comm error riding on the e2e row too", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red", {
          signal: {
            __fleetCommError: {
              kind: "worker-crashed-mid-job",
              message: "lease expired with no report",
              observedAt: FRESH_OBSERVED_AT,
            },
          },
        }),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.surfaceState).toBe("unreachable");
      expect(model.commError?.kind).toBe("worker-crashed-mid-job");
    });

    it("mirrors the chip colour onto surfaceState when no comm error (amber)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        // D5 green, no/failing D6 → chip amber.
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("amber");
      // surfaceState uses the dashboard's ChipColor vocabulary, so amber maps
      // straight through (no comm error → no "unreachable" overlay).
      expect(model.surfaceState).toBe("amber");
    });

    it("unsupported / unwired cells never surface unreachable", () => {
      const unsupported = buildCellModel(mapOf([]), {
        slug: "agno",
        featureId: "agentic-chat",
        isSupported: false,
        isWired: false,
      });
      expect(unsupported.surfaceState).toBe("gray");
      expect(unsupported.commError).toBeUndefined();
    });

    // ── flap-band #70: worker-reclaimed-pending → NEUTRAL "pending" surface ──
    // A lease lapsed and the sweeper re-queued the job (back in flight). The
    // sweep boundary cannot tell a real crash from an expected platform
    // teardown, so this kind renders a NEUTRAL "pending" surface (gray) — NOT
    // the red "unreachable" overlay — so a routine teardown never flaps red.
    describe("worker-reclaimed-pending → pending surface (flap-band #70)", () => {
      const reclaimSignal = {
        __fleetCommError: {
          kind: "worker-reclaimed-pending",
          message: "lease for job j-7 expired; re-queued to pending",
          workerId: "fleet-worker-9",
          observedAt: FRESH_OBSERVED_AT,
        },
      };

      it("a reclaimed-pending comm error surfaces as 'pending', NOT 'unreachable' and NOT red", () => {
        const live = mapOf([
          row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
          row(keyFor("chat", "agno"), "chat", "green"),
          row(keyFor("tools", "agno"), "tools", "green"),
          row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
          row(keyFor("d6", "agno", "agentic-chat"), "d6", "green", {
            signal: reclaimSignal,
          }),
        ]);
        const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
        // The neutral surface — the key flap-band #70 assertion.
        expect(model.surfaceState).toBe("pending");
        expect(model.surfaceState).not.toBe("unreachable");
        expect(model.surfaceState).not.toBe("red");
        // The comm error is still decoded (for the tooltip), it just maps to a
        // different, neutral surface.
        expect(model.commError?.kind).toBe("worker-reclaimed-pending");
        expect(model.commError?.workerId).toBe("fleet-worker-9");
        // The last-known probe colour stays visible underneath the overlay.
        expect(model.chipColor).toBe("green");
      });

      it("a reclaimed-pending comm error must NOT mask an AMBER (partial-failure) chip — amber passes through", () => {
        // Intact D1-D4 ladder + D5 green + D6 red → chipColor amber (partial
        // failure / degraded ladder; the green e2e/chat rows keep the ladder
        // verified so the CF7-F3 #2 absent-D3/D4 collapse doesn't turn this
        // red). Amber is a GENUINE failure colour, not no-data: the
        // neutral "pending" overlay masking it would hide a real partial
        // regression behind a benign gray surface (the same never-mask rule
        // the red passthrough enforces — mirrors the harness
        // fleetSurfaceState, where only green becomes "pending").
        const live = mapOf([
          row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
          row(keyFor("chat", "agno"), "chat", "green"),
          row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
          row(keyFor("d6", "agno", "agentic-chat"), "d6", "red", {
            signal: reclaimSignal,
          }),
        ]);
        const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
        expect(model.chipColor).toBe("amber");
        expect(model.surfaceState).toBe("amber");
        expect(model.surfaceState).not.toBe("pending");
        // The comm error is still decoded (for the tooltip).
        expect(model.commError?.kind).toBe("worker-reclaimed-pending");
      });

      it("a reclaimed-pending comm error on a NO-DATA (gray) cell surfaces 'pending' — the deliberate dashboard-side asymmetry (G3d)", () => {
        // The harness pending gate is green-ONLY because ProbeState has no
        // no-data colour. The dashboard's gray IS its no-data colour, and a
        // no-data cell awaiting a re-queued job is genuinely pending — so
        // gray ALSO routes to "pending" here, deliberately diverging from
        // the harness derivation (pinned shape-wise by
        // commError-contract-drift.test.ts).
        const live = mapOf([
          // No probe rows at all for this cell → chip gray (no-data). The
          // reclaim comm error rides the integration-level d6 aggregate row,
          // which the per-cell resolvers never read (so the chip stays gray).
          row(keyFor("d6", "agno"), "d6", "green", {
            signal: reclaimSignal,
          }),
        ]);
        const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
        expect(model.chipColor).toBe("gray");
        expect(model.isRegression).toBe(false);
        expect(model.surfaceState).toBe("pending");
        expect(model.commError?.kind).toBe("worker-reclaimed-pending");
      });

      it("a reclaimed-pending comm error must NOT mask a RED chip — red passes through", () => {
        const live = mapOf([
          row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red"),
          row(keyFor("d6", "agno"), "d6", "green", {
            signal: reclaimSignal,
          }),
        ]);
        const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
        expect(model.chipColor).toBe("red");
        expect(model.surfaceState).toBe("red");
        expect(model.surfaceState).not.toBe("pending");
        expect(model.commError?.kind).toBe("worker-reclaimed-pending");
      });

      it("a crash (worker-crashed-mid-job) still surfaces red 'unreachable' — only reclaim is neutralized", () => {
        const live = mapOf([
          row(keyFor("d6", "agno", "agentic-chat"), "d6", "green", {
            signal: {
              __fleetCommError: {
                kind: "worker-crashed-mid-job",
                message: "worker crashed running job j-7",
                observedAt: FRESH_OBSERVED_AT,
              },
            },
          }),
        ]);
        const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
        // A KNOWN crash the worker observed directly stays the loud red overlay.
        expect(model.surfaceState).toBe("unreachable");
        expect(model.surfaceState).not.toBe("pending");
        expect(model.commError?.kind).toBe("worker-crashed-mid-job");
      });
    });

    it("the MOST RECENT comm error wins — a newer aggregate (worker-death) beats a stale per-cell one", () => {
      // A STALE per-cell comm error (older `observedAt`) lingers on the per-cell
      // d6 row, scanned BEFORE the aggregate. A NEWER worker-death comm error
      // landed on the aggregate `d6:<slug>` row. Without a recency tie-break the
      // fixed scan order returns the stale per-cell error and masks the real,
      // newer cause. The recency tie-break must surface the aggregate error.
      // Both timestamps sit inside the comm-error staleness window relative to
      // the injected `now`, so this exercises the RECENCY tie-break (not the
      // staleness gate). "STALE" here means older-than-the-other, not aged-out.
      const STALE = "2026-06-04T11:00:00.000Z";
      const NEWER = "2026-06-04T12:00:00.000Z";
      const NOW = Date.parse("2026-06-04T12:30:00.000Z");
      const live = mapOf([
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green", {
          signal: {
            __fleetCommError: {
              kind: "worker-protocol-timeout",
              message: "stale per-cell timeout",
              workerId: "worker-OLD",
              observedAt: STALE,
            },
          },
        }),
        row(keyFor("d6", "agno"), "d6", "green", {
          signal: {
            __fleetCommError: {
              kind: "worker-crashed-mid-job",
              message: "worker died — lease expired",
              workerId: "worker-NEW",
              observedAt: NEWER,
            },
          },
        }),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.surfaceState).toBe("unreachable");
      // The NEWER aggregate (worker-death) error wins despite being scanned LAST.
      expect(model.commError?.kind).toBe("worker-crashed-mid-job");
      expect(model.commError?.workerId).toBe("worker-NEW");
    });

    it("equal timestamps fall back to scan order (per-cell before aggregate)", () => {
      // Stable tie-break: when two comm errors share an `observedAt`, the
      // first-in-scan-order one (the per-cell d6 row) is retained, preserving
      // the prior authority ordering.
      const SAME = "2026-06-04T12:00:00.000Z";
      // `now` within the staleness window so this exercises the equal-timestamp
      // tie-break, not the staleness gate.
      const NOW = Date.parse("2026-06-04T12:30:00.000Z");
      const live = mapOf([
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green", {
          signal: {
            __fleetCommError: {
              kind: "worker-protocol-timeout",
              message: "per-cell",
              workerId: "worker-PERCELL",
              observedAt: SAME,
            },
          },
        }),
        row(keyFor("d6", "agno"), "d6", "green", {
          signal: {
            __fleetCommError: {
              kind: "worker-crashed-mid-job",
              message: "aggregate",
              workerId: "worker-AGG",
              observedAt: SAME,
            },
          },
        }),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.commError?.workerId).toBe("worker-PERCELL");
    });

    // ── G3f: non-d6 fleet-family sweep aggregates ─────────────────────
    // The global lease sweep reclaims jobs of ALL four fleet families and
    // mirrors each comm error onto the status row keyed by the reclaimed
    // job's `probe_key` (harness resolveSweepAggregateKey →
    // aggregateCommError). For the non-d6 families those keys are
    // `d4:<slug>` (smoke), `e2e-demos:<slug>` (demos), and
    // `d5-single-pill-e2e:<slug>` (deep) — rows the dashboard reads NOWHERE
    // else, so the candidate scan must include them or a reclaim/crash
    // overlay on those families is invisible.
    describe("non-d6 fleet-family sweep aggregate keys (G3f)", () => {
      const FAMILY_KEYS = [
        keyFor("d4", "agno"),
        keyFor("e2e-demos", "agno"),
        keyFor("d5-single-pill-e2e", "agno"),
      ];

      it.each(FAMILY_KEYS)(
        "a crash comm error on the %s aggregate row surfaces 'unreachable'",
        (key) => {
          // Destructure-with-fallback (not a `[0]!` non-null assertion):
          // assertion-free, and it would stay valid if
          // `noUncheckedIndexedAccess` were ever enabled (it is NOT in this
          // package's tsconfig today). The sibling helper in
          // src/lib/cell-model.test.ts uses the same shape.
          const [dimension = ""] = key.split(":");
          const live = mapOf([
            row(key, dimension, "green", {
              signal: {
                __fleetCommError: {
                  kind: "worker-crashed-mid-job",
                  message: "lease expired with no terminal report",
                  workerId: "fleet-worker-2",
                  observedAt: FRESH_OBSERVED_AT,
                },
              },
            }),
          ]);
          const model = buildCellModel(
            live,
            wiredInput("agno", "agentic-chat"),
          );
          expect(model.surfaceState).toBe("unreachable");
          expect(model.commError?.kind).toBe("worker-crashed-mid-job");
        },
      );

      it("a reclaim comm error on the d4:<slug> aggregate row surfaces 'pending' on a no-data cell", () => {
        const live = mapOf([
          row(keyFor("d4", "agno"), "d4", "green", {
            signal: {
              __fleetCommError: {
                kind: "worker-reclaimed-pending",
                message: "lease for job j-3 expired; re-queued to pending",
                observedAt: FRESH_OBSERVED_AT,
              },
            },
          }),
        ]);
        const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
        expect(model.surfaceState).toBe("pending");
        expect(model.commError?.kind).toBe("worker-reclaimed-pending");
      });
    });

    // ── Comm-error staleness window ───────────────────────────────────
    // A PoolCommError mirrored onto the `d6:<slug>` aggregate row is NOT
    // overwritten when the pool recovers (recovery writes fresh per-cell
    // rows; nothing clears the stale comm-error blob). Without a staleness
    // window the cell renders "unreachable" forever. A comm error older than
    // the staleness window must be treated as recovered/reachable, mirroring
    // the resolveD3/D4/D5/D6 staleness downgrade.
    describe("comm-error staleness window", () => {
      const NOW = Date.parse("2026-06-04T12:00:00.000Z");

      function commErrorAtAge(ageMs: number) {
        return {
          kind: "worker-crashed-mid-job" as const,
          message: "worker died — lease expired",
          workerId: "worker-stale",
          observedAt: new Date(NOW - ageMs).toISOString(),
        };
      }

      it("a FRESH comm error → surfaceState unreachable", () => {
        const live = mapOf([
          // Pool recovered: fresh green per-cell rows are present.
          row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          row(keyFor("chat", "agno"), "chat", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          row(keyFor("tools", "agno"), "tools", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          row(keyFor("d5", "agno", "agentic-chat"), "d5", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          row(keyFor("d6", "agno", "agentic-chat"), "d6", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          // FRESH comm error on the aggregate row.
          row(keyFor("d6", "agno"), "d6", "green", {
            signal: { __fleetCommError: commErrorAtAge(0) },
          }),
        ]);
        const model = buildCellModel(
          live,
          wiredInput("agno", "agentic-chat"),
          NOW,
        );
        expect(model.surfaceState).toBe("unreachable");
        expect(model.commError?.kind).toBe("worker-crashed-mid-job");
      });

      it("scopes the window PER ROW FAMILY: a health-row comm error older than the liveness window is skipped (G3e)", () => {
        // The candidate scan must not apply the 6h E2E window to
        // liveness-cadence rows: a health row's comm error ages out on the
        // SAME window its row family's resolvers use (45m liveness), while
        // the identical-age comm error on the e2e-cadence d6 aggregate is
        // still fresh under the 6h window.
        const AGE = LIVENESS_STALE_AFTER_MS + 5 * 60 * 1000; // 50m
        expect(AGE).toBeLessThan(E2E_STALE_AFTER_MS);
        const staleHealthOnly = mapOf([
          row(keyFor("health", "agno"), "health", "green", {
            signal: { __fleetCommError: commErrorAtAge(AGE) },
          }),
        ]);
        const healthModel = buildCellModel(
          staleHealthOnly,
          wiredInput("agno", "agentic-chat"),
          NOW,
        );
        // Aged out for the liveness family → treated as recovered.
        expect(healthModel.surfaceState).not.toBe("unreachable");
        expect(healthModel.commError).toBeUndefined();

        const freshAggregate = mapOf([
          row(keyFor("d6", "agno"), "d6", "green", {
            signal: { __fleetCommError: commErrorAtAge(AGE) },
          }),
        ]);
        const aggModel = buildCellModel(
          freshAggregate,
          wiredInput("agno", "agentic-chat"),
          NOW,
        );
        // The same age on the e2e-cadence aggregate is still fresh.
        expect(aggModel.surfaceState).toBe("unreachable");
      });

      it("scopes the window PER ROW FAMILY: a chat/tools-row comm error uses the D4 window (G3e)", () => {
        const AGE = D4_STALE_AFTER_MS + 60 * 1000; // 61m — stale for D4, fresh for e2e
        expect(AGE).toBeLessThan(E2E_STALE_AFTER_MS);
        const staleChatOnly = mapOf([
          row(keyFor("chat", "agno"), "chat", "green", {
            signal: { __fleetCommError: commErrorAtAge(AGE) },
          }),
          row(keyFor("tools", "agno"), "tools", "green", {
            signal: { __fleetCommError: commErrorAtAge(AGE) },
          }),
        ]);
        const model = buildCellModel(
          staleChatOnly,
          wiredInput("agno", "agentic-chat"),
          NOW,
        );
        expect(model.surfaceState).not.toBe("unreachable");
        expect(model.commError).toBeUndefined();
      });

      it("the SAME comm error aged past the staleness window → NOT unreachable (recovered)", () => {
        const live = mapOf([
          // Pool recovered: fresh green per-cell rows are present and the
          // ladder is intact through D6 → chip green.
          row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          row(keyFor("chat", "agno"), "chat", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          row(keyFor("tools", "agno"), "tools", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          row(keyFor("d5", "agno", "agentic-chat"), "d5", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          row(keyFor("d6", "agno", "agentic-chat"), "d6", "green", {
            observed_at: new Date(NOW).toISOString(),
            transitioned_at: new Date(NOW).toISOString(),
          }),
          // STALE comm error blob left over on the aggregate row, never cleared.
          row(keyFor("d6", "agno"), "d6", "green", {
            signal: {
              __fleetCommError: commErrorAtAge(
                E2E_STALE_AFTER_MS + 60 * 60 * 1000,
              ),
            },
          }),
        ]);
        const model = buildCellModel(
          live,
          wiredInput("agno", "agentic-chat"),
          NOW,
        );
        // The aged comm error is treated as recovered — the cell reflects its
        // underlying probe state (green), NOT the sticky "unreachable" overlay.
        expect(model.surfaceState).not.toBe("unreachable");
        expect(model.surfaceState).toBe("green");
        expect(model.commError).toBeUndefined();
      });
    });
  });

  // ── U7: harness driver-error/abort INFRA reds fold to gray (§7.1) ────
  //
  // The harness writes an `errorClass`/`errorDesc` literal into the failing
  // row's `signal` blob. Two of those literals are genuine INFRA failures (a
  // driver threw, or the run was aborted by worker drain) rather than a probe
  // that RAN and failed its functional assertion: `driver-error` and `abort`.
  // The dashboard must fold a cell whose red is attributable ONLY to an infra
  // signal to the existing `gray` ChipColor (no-data), so an infra blip does
  // not masquerade as a genuine product red. Reads BOTH `signal.errorClass`
  // AND `signal.errorDesc` — D4 writes `driver-error` into `errorDesc`, never
  // `errorClass`. A probe that ran and failed a functional assertion (no infra
  // class in either field) STAYS red — that is the masks-real-red guard.
  describe("driver-error/abort infra fold (U7, §7.1)", () => {
    it("folds a D3 red carrying signal.errorClass:'driver-error' to gray", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red", {
          signal: { errorClass: "driver-error", errorDesc: "boom" },
        }),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("gray");
    });

    it("folds a D4 red carrying signal.errorDesc:'driver-error' (the D4 shape) to gray", () => {
      // D4 (d4-chat-roundtrip.ts) writes driver-error into errorDesc, NOT
      // errorClass — an errorClass-only read would leave this RED.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "red", {
          signal: { errorDesc: "driver-error" },
        }),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("gray");
    });

    it("folds a D3 red carrying signal.errorClass:'abort' to gray", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red", {
          signal: { errorClass: "abort", errorDesc: "aborted before start" },
        }),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("gray");
    });

    it("folds a D5 red carrying signal.errorClass:'driver-error' to gray", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red", {
          signal: { errorClass: "driver-error" },
        }),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("gray");
    });

    it("KEEPS a real assertion failure RED — errorClass:'selector-timeout' (no infra class)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red", {
          signal: { errorClass: "selector-timeout", errorDesc: "no match" },
        }),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("red");
    });

    it("KEEPS a real assertion failure RED — feature-timeout (a ran-and-failed signal)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red", {
          signal: { errorClass: "feature-timeout" },
        }),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("red");
    });

    it("KEEPS a red with no signal at all RED (bare red row)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "red"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("red");
    });

    it("KEEPS red when one contributing red is infra but another is a genuine assertion fail", () => {
      // D3 infra (driver-error) + D5 genuine (selector-timeout): the genuine
      // red must NOT be masked by the infra blip on a sibling rung.
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "red", {
          signal: { errorClass: "driver-error" },
        }),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "red", {
          signal: { errorClass: "selector-timeout" },
        }),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("red");
    });

    it("does not disturb a genuinely green cell (no infra signal present)", () => {
      const live = mapOf([
        row(keyFor("e2e", "agno", "agentic-chat"), "e2e", "green"),
        row(keyFor("chat", "agno"), "chat", "green"),
        row(keyFor("tools", "agno"), "tools", "green"),
        row(keyFor("d5", "agno", "agentic-chat"), "d5", "green"),
        row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      ]);
      const model = buildCellModel(live, wiredInput("agno", "agentic-chat"));
      expect(model.chipColor).toBe("green");
    });
  });

  // ── U8: stale cell → gray on the matrix (§7.2 / §6.4) ───────────────
  // The per-depth resolvers only downgrade stale GREEN → amber and let a
  // stale RED pass straight through (frozen-historical). That is correct for
  // the depth LADDER, but for the MATRIX presentation a cell whose freshest
  // observation predates the re-sweep freshness window is "re-sweep pending"
  // — its frozen colour (red INCLUDED) is no longer a live claim, so the chip
  // must render gray, not its stale historical state. The cell is stale only
  // when EVERY contributing row is stale relative to its own family window;
  // one fresh row means the cell was recently swept and keeps its colour.
  // This is the SAME treatment U9's equivalence gate applies (excludes stale
  // prod rows). Composes with U7: a stale driver-error cell is gray either
  // way; the masks-real-red guard is unaffected because a fresh red stays red.
  describe("stale cell → gray on matrix (U8, §7.2)", () => {
    const NOW = Date.parse("2026-05-30T12:00:00Z");

    function rowAtAge(
      key: string,
      dimension: string,
      ageMs: number,
      state: State = "green",
      overrides: Partial<StatusRow> = {},
    ) {
      const observedAt = new Date(NOW - ageMs).toISOString();
      return row(key, dimension, state, {
        observed_at: observedAt,
        transitioned_at: observedAt,
        ...overrides,
      });
    }

    // Past the e2e window — the freshest matrix cadence (6h). A row this old
    // is unambiguously stale for every family window.
    const STALE = E2E_STALE_AFTER_MS + 60 * 60 * 1000;
    const FRESH = 60 * 1000;

    it("folds a stale RED cell to gray (re-sweep pending), not red", () => {
      // A genuine red (no infra class) that is also STALE. Under the depth
      // resolvers this stays red; U8 must fold the matrix chip to gray.
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", STALE, "red"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      // The depth resolver still reports the frozen red (ladder unchanged)…
      expect(model.d3?.status).toBe("red");
      // …but the MATRIX chip is gray: stale, re-sweep pending.
      expect(model.chipColor).toBe("gray");
    });

    it("leaves a FRESH red cell red (only stale folds)", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "red"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.chipColor).toBe("red");
    });

    it("does NOT mark a cell stale when one contributing row is fresh", () => {
      // Stale red e2e but a FRESH chat row → the cell was swept recently, so
      // it is NOT re-sweep-pending; the frozen red still surfaces as red.
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", STALE, "red"),
        rowAtAge(keyFor("chat", "agno"), "chat", FRESH, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.chipColor).toBe("red");
    });

    it("surfaces the observed_at age so operators see staleness", () => {
      const ageMs = STALE;
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", ageMs, "red"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.isStaleCell).toBe(true);
      // Age is the gap between `now` and the freshest contributing row's
      // observed_at (the e2e row here).
      expect(model.observedAtAgeMs).toBe(ageMs);
    });

    it("reports a non-stale cell's age and isStaleCell=false", () => {
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "red"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.isStaleCell).toBe(false);
      expect(model.observedAtAgeMs).toBe(FRESH);
    });

    it("REGRESSION: a fresh driver-error cell still folds to gray (U7 intact)", () => {
      // U7's infra fold must keep working alongside U8: a FRESH driver-error
      // row is gray because of U7 (infra), independent of staleness.
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", FRESH, "red", {
          signal: { errorClass: "driver-error" },
        }),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.isStaleCell).toBe(false);
      expect(model.chipColor).toBe("gray");
    });

    it("a no-data cell (no rows) is not stale and has null age", () => {
      // No contributing rows → no-data gray already; staleness is undefined,
      // not "stale" (there is no observation to be stale).
      const live = mapOf([]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.isStaleCell).toBe(false);
      expect(model.observedAtAgeMs).toBeNull();
      expect(model.chipColor).toBe("gray");
    });

    it("folds a stale GREEN-derived cell to gray too (any colour, not just red)", () => {
      // Every contributing row stale-green. The depth resolvers downgrade the
      // stale greens to amber (so the chip would otherwise be amber/red); U8
      // then folds the stale matrix cell to gray — re-sweep pending applies to
      // any colour, the cell simply hasn't been observed recently.
      const live = mapOf([
        rowAtAge(keyFor("e2e", "agno", "agentic-chat"), "e2e", STALE, "green"),
        rowAtAge(keyFor("chat", "agno"), "chat", STALE, "green"),
        rowAtAge(keyFor("d5", "agno", "agentic-chat"), "d5", STALE, "green"),
        rowAtAge(keyFor("d6", "agno", "agentic-chat"), "d6", STALE, "green"),
      ]);
      const model = buildCellModel(
        live,
        wiredInput("agno", "agentic-chat"),
        NOW,
      );
      expect(model.isStaleCell).toBe(true);
      expect(model.chipColor).toBe("gray");
    });
  });
});
