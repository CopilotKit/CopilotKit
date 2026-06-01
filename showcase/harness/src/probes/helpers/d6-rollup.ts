/**
 * Fail-closed D6 rollup — the structural kill of the false-green class.
 *
 * Maps per-spec-FILE Playwright verdicts to dashboard cells with two
 * independent fail-closed guards:
 *   - A cell is GREEN only when an explicit per-spec PASS row exists for
 *     its mapped spec file. Green is NEVER synthesized from any other
 *     state — not from a missing row, not from a zero-test run, not from
 *     an exit code, not from prior state. This is the original short-
 *     circuit sin the dashboard used to commit; it is structurally
 *     impossible here because the ONLY branch that yields `green` requires
 *     `fileVerdict === "pass"`.
 *   - The DEFAULT for every cell is `unknown`: a spec with no matching
 *     result row, a reporter error, zero collected cases (parser produced
 *     no row), or an explicit `unknown` verdict all resolve to `unknown`.
 *
 * A ran-and-failed spec (`fileVerdict === "red"`) is RED. A declared skip
 * is a DISTINCT `skipped` state — skip ≠ red, skip ≠ missing, skip ≠ green
 * — and takes precedence over any present result row (the skip is the
 * caller's explicit "not applicable" declaration).
 *
 * The function is PURE: `skipped` is the explicit list of skipped spec
 * files for this slug, injected by the caller (the driver passes
 * `declaredSkips(slug)`). The rollup does NOT read the skip-list loader
 * itself — keeping it pure keeps skip ownership at the orchestration
 * layer and keeps this guard trivially testable.
 *
 * The expected cell set is derived strictly 1:1 from
 * `allMappedSpecFiles()` → columns (one mapped spec file → one cell). There
 * is NO aggregate / "all-files-must-pass" collapse branch. Each cell is
 * keyed `d6:<slug>` (the dashboard aggregate-row key contract; per-feature
 * diagnostic side rows are keyed `d6:<slug>/<column>` by the driver, not
 * here).
 */
import {
  allMappedSpecFiles,
  mapSpecFileToCell,
} from "./spec-cell-mapping.js";
import type { SpecFileResult } from "./pw-json-reporter.js";

export type CellState = "green" | "red" | "unknown" | "skipped";

export interface CellRollup {
  /** Dashboard aggregate-row key contract: `d6:<slug>`. */
  key: string;
  /** The feature column this cell occupies (the mapped spec file's column). */
  cellColumn: string;
  state: CellState;
}

export interface RollupInput {
  slug: string;
  specResults: SpecFileResult[];
  /**
   * Spec files declared "not applicable" for this slug, injected by the
   * caller (`declaredSkips(slug)`). Optional — omitting it skips nothing.
   */
  skipped?: string[];
}

export function rollupCells({
  slug,
  specResults,
  skipped = [],
}: RollupInput): CellRollup[] {
  const key = `d6:${slug}`;
  const skippedSet = new Set(skipped);
  // Index result rows by spec file for O(1) lookup; last row wins if a
  // file appears twice (the parser does not emit duplicates today).
  const resultByFile = new Map<string, SpecFileResult>();
  for (const r of specResults) {
    resultByFile.set(r.specFile, r);
  }

  const cells: CellRollup[] = [];
  for (const specFile of allMappedSpecFiles()) {
    const cellColumn = mapSpecFileToCell(specFile);
    // Every file in `allMappedSpecFiles()` maps by construction; guard
    // defensively so an unmapped entry can never silently vanish.
    if (cellColumn === null) continue;

    let state: CellState;
    if (skippedSet.has(specFile)) {
      // Declared skip wins over any present result row.
      state = "skipped";
    } else {
      const result = resultByFile.get(specFile);
      if (result?.fileVerdict === "pass") {
        state = "green";
      } else if (result?.fileVerdict === "red") {
        state = "red";
      } else {
        // Missing row, reporter error, zero cases, or explicit `unknown`.
        // NEVER default to green.
        state = "unknown";
      }
    }

    cells.push({ key, cellColumn, state });
  }

  return cells;
}
