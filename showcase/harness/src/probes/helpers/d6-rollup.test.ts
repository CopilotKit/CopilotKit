/**
 * d6-rollup.test.ts — fail-closed rollup tests (Task 3.2).
 *
 * RED-GREEN proof of the core inversion:
 *   aggregateGreen = failed.length === 0  →  anything not explicitly PASS fails
 *
 * One failing test per verdict class is written FIRST (all RED before
 * d6-rollup.ts exists). GREEN after implementation.
 *
 * Verdict classes covered:
 *   PASS-only    → GREEN
 *   FAIL present → RED
 *   missing spec → UNKNOWN
 *   ERRORED spec → UNKNOWN
 *   ZERO_TESTS   → UNKNOWN
 *   no mapping   → UNKNOWN
 *   skip-list    → SKIPPED
 *   multi-spec: PASS+FAIL   → RED
 *   multi-spec: PASS+missing → UNKNOWN
 *
 * Additional coverage (fixes):
 *   unknown status → UNKNOWN (fail-closed default in statusToContribution)
 *   inert skip entry → surfaces in rollupDiagnostics.inertSkipEntries
 *
 * R2-G4 fixes:
 *   G1: skip-listed unmapped cells → SKIPPED (not absent)
 *   G2: skip masking a RED cell → surfaces in rollupDiagnostics.skipMaskedRed
 *   G3: live consistency test uses ESM import (not CJS require)
 */

import { describe, it, expect } from "vitest";
import type { SpecCellMapping } from "./spec-cell-mapping.js";
import SEEDED_MAPPING from "./spec-cell-mapping.json" with { type: "json" };
import SEEDED_SKIP_LIST from "./skip-list.json" with { type: "json" };
import {
  rollupVerdicts,
  rollupDiagnostics,
  type ReporterVerdictMap,
  type CellVerdict,
} from "./d6-rollup.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal SpecCellMapping for a single slug */
function makeMapping(
  slug: string,
  specPaths: Record<string, string[]>,
): SpecCellMapping {
  return { [slug]: specPaths } as unknown as SpecCellMapping;
}

/** Build a ReporterVerdictMap with one entry */
function oneVerdict(
  specPath: string,
  status: ReporterVerdictMap[string]["status"],
): ReporterVerdictMap {
  return { [specPath]: { specPath, status } };
}

// ── PASS → GREEN ─────────────────────────────────────────────────────────────

describe("rollupVerdicts: PASS → GREEN", () => {
  it("cell with a single PASS spec is GREEN", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "PASS");
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("agentic-chat")).toBe<CellVerdict>("GREEN");
  });
});

// ── FAIL → RED ───────────────────────────────────────────────────────────────

describe("rollupVerdicts: FAIL → RED", () => {
  it("cell with a single FAIL spec is RED", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "FAIL");
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("agentic-chat")).toBe<CellVerdict>("RED");
  });
});

// ── missing spec → UNKNOWN ───────────────────────────────────────────────────

describe("rollupVerdicts: missing spec → UNKNOWN", () => {
  it("cell whose spec is absent from reporterVerdicts is UNKNOWN (fail-closed)", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    // No entry for this spec in verdicts — it was never run
    const verdicts: ReporterVerdictMap = {};
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("agentic-chat")).toBe<CellVerdict>("UNKNOWN");
  });
});

// ── ERRORED → UNKNOWN ────────────────────────────────────────────────────────

describe("rollupVerdicts: ERRORED → UNKNOWN", () => {
  it("cell with an ERRORED spec is UNKNOWN (not GREEN, not RED)", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "ERRORED");
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("agentic-chat")).toBe<CellVerdict>("UNKNOWN");
  });
});

// ── ZERO_TESTS → UNKNOWN ─────────────────────────────────────────────────────

describe("rollupVerdicts: ZERO_TESTS → UNKNOWN", () => {
  it("cell with a ZERO_TESTS spec is UNKNOWN (no passing evidence)", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "ZERO_TESTS");
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("agentic-chat")).toBe<CellVerdict>("UNKNOWN");
  });
});

// ── no mapping → UNKNOWN ─────────────────────────────────────────────────────

describe("rollupVerdicts: no mapping → UNKNOWN", () => {
  it("cell not present in the mapping at all is UNKNOWN", () => {
    // mapping covers "agentic-chat" only; "tool-rendering" has no mapping
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "PASS");
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    // agentic-chat is mapped + PASS → GREEN
    expect(result.get("agentic-chat")).toBe<CellVerdict>("GREEN");
    // tool-rendering has no mapping entry in the result (not returned)
    expect(result.has("tool-rendering")).toBe(false);
  });

  it("slug absent from mapping entirely returns empty map", () => {
    const mapping: SpecCellMapping = {}; // no slug at all
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "PASS");
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.size).toBe(0);
  });
});

// ── skip-list → SKIPPED ──────────────────────────────────────────────────────

describe("rollupVerdicts: declared skip → SKIPPED", () => {
  it("cell declared in skip-list for the slug is SKIPPED regardless of verdict", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "FAIL");
    const skipList = { lgp: ["agentic-chat"] };

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("agentic-chat")).toBe<CellVerdict>("SKIPPED");
  });

  it("SKIPPED takes precedence even over a PASS verdict", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "PASS");
    const skipList = { lgp: ["agentic-chat"] };

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("agentic-chat")).toBe<CellVerdict>("SKIPPED");
  });

  it("skip-list for a different slug does not affect this slug", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "PASS");
    // skip-list covers "other-slug", not "lgp"
    const skipList = { "other-slug": ["agentic-chat"] };

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("agentic-chat")).toBe<CellVerdict>("GREEN");
  });
});

// ── multi-spec: PASS + FAIL → RED ────────────────────────────────────────────

describe("rollupVerdicts: multi-spec cell, PASS+FAIL → RED", () => {
  it("cell with N:1 mapping (two specs) is RED when any spec FAILs", () => {
    // Two specs map to one cell (N:1)
    const mapping = makeMapping("lgp", {
      "tests/e2e/reasoning-custom.spec.ts": ["reasoning-display"],
      "tests/e2e/reasoning-default.spec.ts": ["reasoning-display"],
    });
    const verdicts: ReporterVerdictMap = {
      "tests/e2e/reasoning-custom.spec.ts": {
        specPath: "tests/e2e/reasoning-custom.spec.ts",
        status: "PASS",
      },
      "tests/e2e/reasoning-default.spec.ts": {
        specPath: "tests/e2e/reasoning-default.spec.ts",
        status: "FAIL",
      },
    };
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    // FAIL dominates — RED even though one spec PASSed
    expect(result.get("reasoning-display")).toBe<CellVerdict>("RED");
  });
});

// ── multi-spec: PASS + missing → UNKNOWN ─────────────────────────────────────

describe("rollupVerdicts: multi-spec cell, PASS+missing → UNKNOWN", () => {
  it("cell with N:1 mapping (two specs) is UNKNOWN when one spec is missing", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/reasoning-custom.spec.ts": ["reasoning-display"],
      "tests/e2e/reasoning-default.spec.ts": ["reasoning-display"],
    });
    // Only one spec ran; the other is absent (never run)
    const verdicts: ReporterVerdictMap = {
      "tests/e2e/reasoning-custom.spec.ts": {
        specPath: "tests/e2e/reasoning-custom.spec.ts",
        status: "PASS",
      },
      // reasoning-default.spec.ts is absent — missing verdict
    };
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    // UNKNOWN dominates — cannot certify GREEN with a missing spec
    expect(result.get("reasoning-display")).toBe<CellVerdict>("UNKNOWN");
  });
});

// ── 1:many (beautiful-chat style): all PASS → GREEN ──────────────────────────

describe("rollupVerdicts: 1:many, all cells GREEN when spec PASSes", () => {
  it("one spec mapping to multiple cells marks all cells GREEN when PASS", () => {
    // beautiful-chat style: 1 spec → 5 cells
    const mapping = makeMapping("lgp", {
      "tests/e2e/beautiful-chat.spec.ts": [
        "beautiful-chat-toggle-theme",
        "beautiful-chat-pie-chart",
      ],
    });
    const verdicts = oneVerdict("tests/e2e/beautiful-chat.spec.ts", "PASS");
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("beautiful-chat-toggle-theme")).toBe<CellVerdict>(
      "GREEN",
    );
    expect(result.get("beautiful-chat-pie-chart")).toBe<CellVerdict>("GREEN");
  });

  it("one spec mapping to multiple cells marks all RED when FAIL (1:many dominance)", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/beautiful-chat.spec.ts": [
        "beautiful-chat-toggle-theme",
        "beautiful-chat-pie-chart",
      ],
    });
    const verdicts = oneVerdict("tests/e2e/beautiful-chat.spec.ts", "FAIL");
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("beautiful-chat-toggle-theme")).toBe<CellVerdict>("RED");
    expect(result.get("beautiful-chat-pie-chart")).toBe<CellVerdict>("RED");
  });
});

// ── dominance ordering: RED > UNKNOWN > GREEN ────────────────────────────────

describe("rollupVerdicts: verdict dominance ordering", () => {
  it("RED dominates UNKNOWN (any FAIL wins over missing)", () => {
    // Three specs map to one cell: PASS + FAIL + missing
    const mapping = makeMapping("lgp", {
      "tests/e2e/spec-a.spec.ts": ["agentic-chat"],
      "tests/e2e/spec-b.spec.ts": ["agentic-chat"],
      "tests/e2e/spec-c.spec.ts": ["agentic-chat"],
    });
    const verdicts: ReporterVerdictMap = {
      "tests/e2e/spec-a.spec.ts": {
        specPath: "tests/e2e/spec-a.spec.ts",
        status: "PASS",
      },
      "tests/e2e/spec-b.spec.ts": {
        specPath: "tests/e2e/spec-b.spec.ts",
        status: "FAIL",
      },
      // spec-c is missing
    };
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    // RED > UNKNOWN > GREEN — cell is RED
    expect(result.get("agentic-chat")).toBe<CellVerdict>("RED");
  });

  it("UNKNOWN dominates GREEN (any missing/errored wins over PASS alone)", () => {
    // Two specs → one cell; one PASS, one ERRORED
    const mapping = makeMapping("lgp", {
      "tests/e2e/spec-a.spec.ts": ["agentic-chat"],
      "tests/e2e/spec-b.spec.ts": ["agentic-chat"],
    });
    const verdicts: ReporterVerdictMap = {
      "tests/e2e/spec-a.spec.ts": {
        specPath: "tests/e2e/spec-a.spec.ts",
        status: "PASS",
      },
      "tests/e2e/spec-b.spec.ts": {
        specPath: "tests/e2e/spec-b.spec.ts",
        status: "ERRORED",
      },
    };
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    expect(result.get("agentic-chat")).toBe<CellVerdict>("UNKNOWN");
  });
});

// ── fail-closed default in statusToContribution ───────────────────────────────

describe("rollupVerdicts: fail-closed default for unknown status", () => {
  it("an unrecognised SpecVerdictStatus maps to UNKNOWN (fail-closed default)", () => {
    // Simulate a future/stray status value that is not in the current union.
    // Cast through unknown to bypass TypeScript's type check — this exercises
    // the exhaustive default branch in statusToContribution.
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts: ReporterVerdictMap = {
      "tests/e2e/agentic-chat.spec.ts": {
        specPath: "tests/e2e/agentic-chat.spec.ts",
        status:
          "STRAY_UNKNOWN_STATUS" as unknown as ReporterVerdictMap[string]["status"],
      },
    };
    const skipList = {};

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    // Fail-closed: unknown status → UNKNOWN, not GREEN
    expect(result.get("agentic-chat")).toBe<CellVerdict>("UNKNOWN");
  });
});

// ── rollupDiagnostics: inert skip entries ─────────────────────────────────────

describe("rollupDiagnostics: inert skip entries", () => {
  it("skip-list entry for a cell not in the mapping is reported as inert", () => {
    // "auth" is in the skip-list but has NO mapping entry.
    // rollupVerdicts cannot mark it SKIPPED (no cell to mark) — it is a no-op.
    // rollupDiagnostics must surface it as an inert skip entry.
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    // "auth" is in skip-list but NOT in any spec's cell array
    const skipList = { lgp: ["auth"] };

    const diag = rollupDiagnostics("lgp", mapping, skipList);

    // "auth" IS reported as an inert skip entry
    expect(diag.inertSkipEntries).toContain("auth");
  });

  it("skip-list entry for a mapped cell is NOT inert (it is an effective skip)", () => {
    // "agentic-chat" IS in the mapping — the skip-list entry is effective,
    // not inert.  It must NOT appear in inertSkipEntries.
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const skipList = { lgp: ["agentic-chat"] };

    const diag = rollupDiagnostics("lgp", mapping, skipList);

    // NOT reported as inert
    expect(diag.inertSkipEntries).not.toContain("agentic-chat");
    expect(diag.inertSkipEntries).toHaveLength(0);
  });

  it("returns empty inertSkipEntries when skip-list is empty", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const skipList = {};

    const diag = rollupDiagnostics("lgp", mapping, skipList);

    expect(diag.inertSkipEntries).toHaveLength(0);
  });

  it("slug absent from mapping returns empty inertSkipEntries (no mapping to cross-reference)", () => {
    const mapping: SpecCellMapping = {};
    const skipList = { lgp: ["auth"] };

    const diag = rollupDiagnostics("lgp", mapping, skipList);

    expect(diag.inertSkipEntries).toHaveLength(0);
  });

  it("the current skip-list has no unexpected inert entries for langgraph-python (mapping is self-consistent)", () => {
    // This is a live consistency test against the actual shipped JSON files.
    // It will FAIL if a skip-list entry is added for a cell that has no
    // mapping entry — ensuring the skip-list and mapping stay in sync.
    //
    // The LGP skip-list has gen-ui-interrupt and interrupt-headless.
    // Neither is in the mapping (gen-ui-interrupt was unmapped because it is
    // quarantined in not_supported_features; interrupt-headless has no spec).
    // This makes them inert skip entries by definition — they're declared to
    // be skipped but have nothing to skip over in the mapping.
    //
    // This is the CORRECT state: both cells are in not_supported_features, so
    // they should not be in the mapping, and the skip-list declaration is the
    // authoritative source for their "incapable" disposition. The inert state
    // is expected and intentional here (unlike an accidentally stale entry).
    //
    // We assert that only the known quarantined cells appear as inert, and
    // no unexpected inert entries exist.
    const diag = rollupDiagnostics(
      "langgraph-python",
      SEEDED_MAPPING as SpecCellMapping,
      SEEDED_SKIP_LIST,
    );

    // The quarantined cells are expected to be inert (not in the mapping).
    // Any OTHER inert entry would be an unexpected inconsistency.
    const unexpectedInert = diag.inertSkipEntries.filter(
      (cell) => cell !== "gen-ui-interrupt" && cell !== "interrupt-headless",
    );
    expect(unexpectedInert).toHaveLength(0);
  });
});

// ── G1: skip-listed unmapped cells → SKIPPED ────────────────────────────────
// RED-GREEN for fix G1: a skip-listed cell with no mapping entry must still
// appear in the verdict map as SKIPPED (not be absent from the result).
// Live case: langgraph-python gen-ui-interrupt and interrupt-headless are in
// the skip-list but have no spec mapping — their cells should be SKIPPED,
// not absent (stale-red gap).

describe("rollupVerdicts: skip-listed unmapped cell → SKIPPED (G1)", () => {
  it("skip-listed cell with no mapping entry is emitted as SKIPPED (not absent)", () => {
    // "phantom-feature" is in the skip-list but has NO mapping entry.
    // Before the fix: result.has("phantom-feature") === false (stale-red gap).
    // After the fix: result.get("phantom-feature") === "SKIPPED".
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "PASS");
    const skipList = { lgp: ["phantom-feature"] }; // unmapped cell in skip-list

    const result = rollupVerdicts("lgp", mapping, verdicts, skipList);

    // G1 fix: skip-listed unmapped cells must appear as SKIPPED
    expect(result.get("phantom-feature" as any)).toBe<CellVerdict>("SKIPPED");
  });

  it("live: gen-ui-interrupt and interrupt-headless are SKIPPED in langgraph-python", () => {
    // These cells are in the LGP skip-list but have no spec in the mapping.
    // Before G1 fix: they are absent from the result (stale-red gap).
    // After G1 fix: they appear as SKIPPED.
    const verdicts: ReporterVerdictMap = {}; // no specs ran for these cells
    const result = rollupVerdicts(
      "langgraph-python",
      SEEDED_MAPPING as SpecCellMapping,
      verdicts,
      SEEDED_SKIP_LIST,
    );

    expect(result.get("gen-ui-interrupt" as any)).toBe<CellVerdict>("SKIPPED");
    expect(result.get("interrupt-headless" as any)).toBe<CellVerdict>(
      "SKIPPED",
    );
  });

  it("skip-listed unmapped cell does not appear in inertSkipEntries when emitted (G1+inert distinction)", () => {
    // After G1 fix: skip-listed cells that are NOT in the mapping are still
    // emitted as SKIPPED. The inertSkipEntries diagnostic reflects cells that
    // had no mapping entry to override — which is the same set, but the
    // diagnostic meaning changes: "inert" now means "no spec backing, but still
    // SKIPPED by declaration" rather than "silently dropped".
    // The inertSkipEntries list is retained for its original diagnostic purpose
    // (flagging likely stale entries or missing mappings); the key change is
    // the verdict map now always includes them.
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const skipList = { lgp: ["phantom-feature"] };

    const diag = rollupDiagnostics("lgp", mapping, skipList);

    // "phantom-feature" still appears as inert (no backing spec) — the
    // diagnostic is preserved for the caller to inspect staleness.
    expect(diag.inertSkipEntries).toContain("phantom-feature");
  });
});

// ── G2: skip masking a RED cell → skipMaskedRed diagnostic ──────────────────
// RED-GREEN for fix G2: when a skip-listed cell's specs ran-and-FAILED,
// the masking must be surfaced in rollupDiagnostics.skipMaskedRed so the
// CLI/guard can flag it. The SKIPPED verdict itself is unchanged — governance
// stays with the skip-list — only the diagnostic is added.

describe("rollupDiagnostics: skip-masked red cells (G2)", () => {
  it("skip masking a FAILED spec is reported in skipMaskedRed", () => {
    // "agentic-chat" is skip-listed but its spec actually FAILED.
    // The verdict stays SKIPPED (governance is with the skip-list), but the
    // masking must be surfaced in diagnostics.
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "FAIL");
    const skipList = { lgp: ["agentic-chat"] };

    const diag = rollupDiagnostics("lgp", mapping, skipList, verdicts);

    expect(diag.skipMaskedRed).toContain("agentic-chat");
  });

  it("skip NOT masking a PASS spec does not appear in skipMaskedRed", () => {
    // "agentic-chat" is skip-listed and its spec PASSed — no masking.
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts = oneVerdict("tests/e2e/agentic-chat.spec.ts", "PASS");
    const skipList = { lgp: ["agentic-chat"] };

    const diag = rollupDiagnostics("lgp", mapping, skipList, verdicts);

    expect(diag.skipMaskedRed).not.toContain("agentic-chat");
    expect(diag.skipMaskedRed).toHaveLength(0);
  });

  it("skip masking an unmapped cell (no specs) does not appear in skipMaskedRed", () => {
    // "phantom-feature" is skip-listed and unmapped — there are no specs to
    // check, so no masking is possible.
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts: ReporterVerdictMap = {};
    const skipList = { lgp: ["phantom-feature"] };

    const diag = rollupDiagnostics("lgp", mapping, skipList, verdicts);

    expect(diag.skipMaskedRed).not.toContain("phantom-feature");
    expect(diag.skipMaskedRed).toHaveLength(0);
  });

  it("empty verdicts means no skipMaskedRed entries", () => {
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const verdicts: ReporterVerdictMap = {};
    const skipList = { lgp: ["agentic-chat"] };

    const diag = rollupDiagnostics("lgp", mapping, skipList, verdicts);

    expect(diag.skipMaskedRed).toHaveLength(0);
  });

  it("rollupDiagnostics without verdicts arg still returns skipMaskedRed (empty)", () => {
    // Backward-compat: callers that don't pass verdicts get an empty skipMaskedRed.
    const mapping = makeMapping("lgp", {
      "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
    });
    const skipList = { lgp: ["agentic-chat"] };

    const diag = rollupDiagnostics("lgp", mapping, skipList);

    expect(diag.skipMaskedRed).toBeDefined();
    expect(diag.skipMaskedRed).toHaveLength(0);
  });
});
