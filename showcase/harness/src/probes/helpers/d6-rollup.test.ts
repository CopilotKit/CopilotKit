/**
 * Fail-closed D6 rollup tests — GATE B (the original-sin guard).
 *
 * The rollup is the structural kill of the false-green class: a cell is
 * GREEN only when an explicit per-spec PASS row exists for its mapped
 * spec file. Every other state — missing row, reporter error, zero
 * collected cases, `unknown` verdict — defaults to UNKNOWN, NEVER green.
 * A ran-and-failed spec is RED; a declared skip is a DISTINCT `skipped`
 * state (skip ≠ red, skip ≠ missing, skip ≠ green).
 *
 * These are red→green regression tests: they MUST exist and pass before
 * the driver cutover (a later task) consumes the rollup. The two
 * load-bearing guards are exercised explicitly:
 *   - ZERO pass rows → ZERO green cells (the original short-circuit sin).
 *   - empty / zero-test report → all affected cells UNKNOWN, none green.
 *
 * `rollupCells` is PURE: `skipped` is injected by the caller (the driver
 * passes `declaredSkips(slug)`); the rollup never imports the skip-list
 * loader. The expected cell set is derived strictly 1:1 from
 * `allMappedSpecFiles()` — one mapped spec file → one cell, no aggregate.
 */
import { describe, it, expect } from "vitest";
import { rollupCells } from "./d6-rollup.js";
import {
  allMappedSpecFiles,
  mapSpecFileToCell,
} from "./spec-cell-mapping.js";

const SLUG = "langgraph-python";
const MAPPED_FILE_COUNT = allMappedSpecFiles().length;

describe("d6-rollup fail-closed (GATE B)", () => {
  // GUARD 1 — the original false-green: a result set with ZERO pass rows
  // must yield ZERO green cells. No PASS row anywhere ⇒ nothing green.
  it("ZERO pass rows → ZERO green cells", () => {
    const cells = rollupCells({
      slug: SLUG,
      specResults: [
        { specFile: "frontend-tools.spec.ts", cases: [], fileVerdict: "red" },
        { specFile: "voice.spec.ts", cases: [], fileVerdict: "unknown" },
      ],
    });
    expect(cells.filter((c) => c.state === "green")).toEqual([]);
  });

  // GUARD 1 (degenerate) — no result rows at all → unknown, never green.
  it("no result row for any mapped spec → all unknown, none green", () => {
    const cells = rollupCells({ slug: SLUG, specResults: [] });
    expect(cells.every((c) => c.state !== "green")).toBe(true);
    expect(cells.every((c) => c.state === "unknown")).toBe(true);
  });

  // GUARD 2 — empty / zero-test Playwright report (parser returns []):
  // all affected cells UNKNOWN, none green. Cannot manufacture green from
  // an empty run.
  it("empty / zero-test report → all cells UNKNOWN, none green", () => {
    const cells = rollupCells({ slug: SLUG, specResults: [] });
    expect(cells.some((c) => c.state === "green")).toBe(false);
    expect(cells.length).toBe(MAPPED_FILE_COUNT);
    expect(cells.every((c) => c.state === "unknown")).toBe(true);
  });

  // The rollup derives exactly one cell per mapped spec file (strict 1:1,
  // no aggregate row), every cell keyed `d6:<slug>`.
  it("derives one cell per mapped spec file, keyed d6:<slug>", () => {
    const cells = rollupCells({ slug: SLUG, specResults: [] });
    expect(cells.length).toBe(MAPPED_FILE_COUNT);
    expect(cells.every((c) => c.key === `d6:${SLUG}`)).toBe(true);
    const columns = cells.map((c) => c.cellColumn).sort();
    const expected = allMappedSpecFiles()
      .map((f) => mapSpecFileToCell(f) as string)
      .sort();
    expect(columns).toEqual(expected);
  });

  // POSITIVE — an explicit PASS row greens EXACTLY that cell, nothing else.
  it("explicit PASS row → GREEN for that cell only", () => {
    const cells = rollupCells({
      slug: SLUG,
      specResults: [
        { specFile: "hitl-in-chat.spec.ts", cases: [], fileVerdict: "pass" },
      ],
    });
    expect(cells.find((c) => c.cellColumn === "hitl-in-chat")?.state).toBe(
      "green",
    );
    expect(cells.filter((c) => c.state === "green").length).toBe(1);
  });

  // RED — a ran-and-failed spec is RED, never green.
  it("a failed spec (fileVerdict red) → RED", () => {
    const cells = rollupCells({
      slug: SLUG,
      specResults: [
        { specFile: "frontend-tools.spec.ts", cases: [], fileVerdict: "red" },
      ],
    });
    expect(cells.find((c) => c.cellColumn === "frontend-tools")?.state).toBe(
      "red",
    );
    expect(cells.some((c) => c.state === "green")).toBe(false);
  });

  // UNKNOWN — a mapped spec with no matching result row → UNKNOWN, not green.
  it("a mapped spec with no result row → UNKNOWN, not green", () => {
    const cells = rollupCells({
      slug: SLUG,
      // only one spec has a row; every other mapped spec has none.
      specResults: [
        { specFile: "hitl-in-chat.spec.ts", cases: [], fileVerdict: "pass" },
      ],
    });
    const missing = cells.find((c) => c.cellColumn === "voice");
    expect(missing?.state).toBe("unknown");
  });

  // UNKNOWN — a matching row whose verdict is `unknown` → UNKNOWN, not green.
  it("a result row with fileVerdict unknown → UNKNOWN, not green", () => {
    const cells = rollupCells({
      slug: SLUG,
      specResults: [
        { specFile: "voice.spec.ts", cases: [], fileVerdict: "unknown" },
      ],
    });
    expect(cells.find((c) => c.cellColumn === "voice")?.state).toBe("unknown");
    expect(cells.some((c) => c.state === "green")).toBe(false);
  });

  // SKIP — a declared skip is a DISTINCT `skipped` state: never red, never
  // green, never silently missing. The caller injects `skipped`.
  it("declared skip → skipped state, never red and never green", () => {
    const cells = rollupCells({
      slug: "google-adk",
      specResults: [],
      skipped: ["gen-ui-interrupt.spec.ts"],
    });
    const cell = cells.find((c) => c.cellColumn === "gen-ui-interrupt");
    expect(cell?.state).toBe("skipped");
    expect(cells.some((c) => c.state === "red")).toBe(false);
    expect(cells.some((c) => c.state === "green")).toBe(false);
  });

  // SKIP precedence — a skipped spec stays `skipped` even if a (stale)
  // result row exists for it; skip is the caller's explicit declaration.
  it("skip takes precedence over a present result row", () => {
    const cells = rollupCells({
      slug: "google-adk",
      specResults: [
        {
          specFile: "gen-ui-interrupt.spec.ts",
          cases: [],
          fileVerdict: "red",
        },
      ],
      skipped: ["gen-ui-interrupt.spec.ts"],
    });
    expect(cells.find((c) => c.cellColumn === "gen-ui-interrupt")?.state).toBe(
      "skipped",
    );
  });

  // PURITY — `skipped` is optional; omitting it skips nothing.
  it("omitting skipped is valid and skips nothing", () => {
    const cells = rollupCells({ slug: SLUG, specResults: [] });
    expect(cells.some((c) => c.state === "skipped")).toBe(false);
  });
});
