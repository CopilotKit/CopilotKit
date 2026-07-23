/**
 * d6-rollup.ts — fail-closed D6 verdict rollup (Task 3.2).
 *
 * ## Core inversion (the point of this module)
 *
 * The legacy d6-all-pills.ts driver computes:
 *
 *   aggregateGreen = failed.length === 0
 *
 * where `failed` seeds only from `missingScript`. Every other absence
 * (missing verdict, collection error, zero tests) is silently skipped and
 * treated as green. This is an OPEN-WORLD assumption — anything not
 * explicitly red is green.
 *
 * This module inverts that to a CLOSED-WORLD assumption:
 *
 *   GREEN  iff ALL specs for the cell produce status PASS
 *   RED    if ANY spec produces status FAIL
 *   UNKNOWN if any spec is missing / ERRORED / ZERO_TESTS, or the
 *            cell has no mapping entry at all (fail-closed default)
 *   SKIPPED iff the cell is declared in the skip-list for this slug
 *
 * Dominance ordering (highest wins): RED > UNKNOWN > GREEN.
 * SKIPPED is applied before any verdict computation and short-circuits.
 *
 * ## N:M mapping (Decision A, impl plan §1)
 *
 * The function builds the INVERSE INDEX (cell → set of spec paths) from
 * the N:M mapping. For a cell to be GREEN every spec in its inverse set
 * must be PASS. This naturally handles:
 *
 *   1:1   — one spec → one cell (common case)
 *   1:N   — one spec → N cells (beautiful-chat: one spec → 5 cells)
 *   M:1   — M specs → one cell (reasoning: custom+default → reasoning-display)
 *   M:N   — combination
 *
 * ## Inputs
 *
 * - `slug`           — integration slug (key into mapping and skipList)
 * - `slugMapping`    — RESOLVED per-slug mapping (spec-path → cell[])
 * - `reporterVerdicts` — Map of specPath → SpecVerdict (from pw-json-reporter)
 * - `skipList`       — skip-list map (slug → cell[]) from loadSkipList()
 *
 * ## Output
 *
 * `rollupVerdicts` returns Map<D5FeatureType, CellVerdict> — one entry per
 * cell that appears in this slug's mapping. Cells absent from the mapping
 * are not returned; the caller treats any cell not in the result as UNKNOWN.
 *
 * `rollupDiagnostics` exposes data-model inconsistencies the guard/CLI can
 * assert on without altering the core verdict contract:
 *
 *   inertSkipEntries — skip-list cells for this slug that match no cell in
 *                      the inverse index. Such entries are silent no-ops in
 *                      the rollup and likely indicate a stale skip-list entry
 *                      or a missing mapping entry.
 */

import type { D5FeatureType } from "./d5-registry.js";

/**
 * Resolved per-slug mapping: spec-path -> cell list. This is the output of
 * `loadSpecCellMapping(slug, deps)` (base ⊕ override ⊖ auto-omit, restricted to
 * on-disk specs). Both rollup functions consume this resolved map DIRECTLY —
 * `runSpecDrivenD6` resolves ONCE and feeds the SAME resolved slug-map to every
 * consumer so they cannot diverge (no internal `mapping[slug]` lookup).
 */
export type ResolvedSlugMapping = Record<string, D5FeatureType[]>;

// ── Reporter verdict contract ─────────────────────────────────────────────────
//
// Minimal shared type that the parser slot (pw-json-reporter.ts, Task 3.1)
// will export under the same shape. If the parser module is not yet in the
// codebase (Phase-0 execution order), consumers declare this locally and
// the cli slot aligns to it.

/**
 * Per-spec verdict status produced by the Playwright JSON reporter parser.
 *
 * PASS       — spec ran and all tests passed
 * FAIL       — spec ran and ≥1 test failed
 * ERRORED    — spec could not be collected or threw a runtime error
 * ZERO_TESTS — spec was collected but reported zero test cases
 */
export type SpecVerdictStatus = "PASS" | "FAIL" | "ERRORED" | "ZERO_TESTS";

/** Single spec verdict entry. */
export interface SpecVerdict {
  specPath: string;
  status: SpecVerdictStatus;
}

/**
 * Input type for `rollupVerdicts`.
 *
 * Keyed by specPath (relative to integration root, matching the JSON
 * reporter grouping and the mapping keys). The cli slot and driver
 * populate this after parsing a Playwright JSON report.
 */
export type ReporterVerdictMap = Record<string, SpecVerdict>;

// ── Cell verdict ─────────────────────────────────────────────────────────────

/** Fail-closed cell verdict. RED and UNKNOWN both render failed on the dashboard. */
export type CellVerdict = "GREEN" | "RED" | "UNKNOWN" | "SKIPPED";

// ── Diagnostics ──────────────────────────────────────────────────────────────

/**
 * Rollup diagnostics: problems discovered during verdict computation that
 * do not produce a per-cell verdict but indicate data-model inconsistencies
 * the caller or CI guard should assert on.
 */
export interface RollupDiagnostics {
  /**
   * Skip-list cells for this slug that have no corresponding entry in the
   * inverse index (i.e. no spec in the mapping maps to that cell).
   *
   * Note (G1): after the closed-world skip fix, these cells ARE still
   * emitted as SKIPPED in the verdict map — the diagnostic here flags that
   * their skip declaration has no spec backing, which usually means either
   * the skip-list is stale (the cell was removed from the mapping) or the
   * mapping is missing an entry that should exist.
   */
  inertSkipEntries: readonly D5FeatureType[];

  /**
   * Skip-list cells for this slug whose specs actually ran and produced a
   * FAIL verdict — i.e. the skip is masking a real failure.
   *
   * The SKIPPED verdict itself is NOT changed (governance stays with the
   * skip-list), but callers (CLI, CI guard) can use this list to alert that
   * a skip entry is hiding an active regression rather than a known flaky
   * test.
   */
  skipMaskedRed: readonly D5FeatureType[];
}

// ── Dominance helpers ─────────────────────────────────────────────────────────

/** Numeric rank for dominance comparison (higher = wins). */
const VERDICT_RANK: Record<CellVerdict, number> = {
  GREEN: 0,
  UNKNOWN: 1,
  RED: 2,
  SKIPPED: 3, // SKIPPED is resolved before entering the dominance loop
};

/** Returns the dominant of two verdicts (RED > UNKNOWN > GREEN). */
function dominates(a: CellVerdict, b: CellVerdict): CellVerdict {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

/** Converts a SpecVerdictStatus to a CellVerdict contribution. */
function statusToContribution(status: SpecVerdictStatus): CellVerdict {
  switch (status) {
    case "PASS":
      return "GREEN";
    case "FAIL":
      return "RED";
    case "ERRORED":
    case "ZERO_TESTS":
      return "UNKNOWN";
    default: {
      // Exhaustive default: an unknown status value is fail-closed.
      // This guards against future SpecVerdictStatus additions that
      // miss a branch in this switch.
      const _exhaustive: never = status;
      void _exhaustive;
      return "UNKNOWN";
    }
  }
}

// ── Shared inverse-index builder ──────────────────────────────────────────────

/**
 * Build the inverse index (cell → set of spec paths) from a slug's mapping
 * and compute which skip-list entries are inert (match no mapped cell).
 *
 * Extracted so both `rollupVerdicts` and `rollupDiagnostics` share the
 * same computation without duplicating it.
 *
 * G1 fix: also returns `unmappedSkipCells` — skip-list cells that have no
 * mapping entry. These are "inert" in the old sense (no spec backs them), but
 * they must still be emitted as SKIPPED by `rollupVerdicts` so that declaring
 * a feature not-supported actually greens its cell instead of leaving it absent
 * (stale-red gap).
 */
function buildInverseIndex(
  slugMapping: Record<string, string[]>,
  skipEntries: readonly string[],
): {
  inverseIndex: Map<D5FeatureType, Set<string>>;
  inertSkipEntries: D5FeatureType[];
  unmappedSkipCells: D5FeatureType[];
} {
  const inverseIndex = new Map<D5FeatureType, Set<string>>();
  for (const [specPath, cells] of Object.entries(slugMapping)) {
    for (const cell of cells) {
      const existing = inverseIndex.get(cell as D5FeatureType);
      if (existing != null) {
        existing.add(specPath);
      } else {
        inverseIndex.set(cell as D5FeatureType, new Set([specPath]));
      }
    }
  }

  const inertSkipEntries: D5FeatureType[] = [];
  const unmappedSkipCells: D5FeatureType[] = [];
  for (const entry of skipEntries) {
    if (!inverseIndex.has(entry as D5FeatureType)) {
      inertSkipEntries.push(entry as D5FeatureType);
      unmappedSkipCells.push(entry as D5FeatureType);
    }
  }

  return { inverseIndex, inertSkipEntries, unmappedSkipCells };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute fail-closed cell verdicts for a single integration slug.
 *
 * Builds the inverse index (cell → set of spec paths) from the N:M
 * mapping and resolves each cell against the reporter verdicts.
 *
 * Returns Map<D5FeatureType, CellVerdict> — one entry per cell that appears
 * in this slug's mapping OR in the slug's skip-list. Cells absent from both
 * are not returned; the caller treats any cell not in the result as UNKNOWN.
 *
 * G1 fix: skip-listed cells with no mapping entry are also emitted as SKIPPED
 * (closed-world skip semantics). Previously they were silently absent, leaving
 * a stale-red gap for features declared not-supported (e.g. langgraph-python
 * gen-ui-interrupt, interrupt-headless).
 *
 * Use `rollupDiagnostics` to surface data-model inconsistencies (e.g.
 * inert skip entries, skip-masked reds) without altering this return contract.
 *
 * @param slug             - Integration slug (used only for the skip-list lookup).
 * @param slugMapping      - RESOLVED per-slug mapping (spec-path → cells),
 *                           already resolved by loadSpecCellMapping(slug, deps).
 * @param reporterVerdicts - Per-spec verdict map from pw-json-reporter.
 * @param skipList         - Skip-list map (slug → D5FeatureType strings).
 * @returns Map from D5FeatureType to CellVerdict for this slug's cells only.
 */
export function rollupVerdicts(
  slug: string,
  slugMapping: ResolvedSlugMapping,
  reporterVerdicts: ReporterVerdictMap,
  skipList: Readonly<Record<string, readonly string[]>>,
): Map<D5FeatureType, CellVerdict> {
  const result = new Map<D5FeatureType, CellVerdict>();

  if (slugMapping == null) {
    // Empty resolved map — return empty (all cells UNKNOWN by absence).
    // Note: a slug with specs on disk resolves to a NON-empty map, so this
    // branch is now reached only for a genuinely-empty resolved map (zero
    // specs on disk / runner error) — the fail-closed backstop, not the
    // "unmapped slug" case (which no longer exists under base+delta).
    return result;
  }

  const skipEntries = skipList[slug] ?? [];
  const skipSet = new Set<string>(skipEntries);

  const { inverseIndex, unmappedSkipCells } = buildInverseIndex(
    slugMapping,
    skipEntries,
  );

  // G1 fix: emit SKIPPED for skip-listed cells that have no mapping entry.
  // These cells have no spec backing — but the skip declaration is the
  // authoritative source for their "incapable" disposition, so they must
  // appear as SKIPPED rather than be absent (stale-red gap).
  for (const cell of unmappedSkipCells) {
    result.set(cell, "SKIPPED");
  }

  // Resolve each cell's verdict from the inverse index
  for (const [cell, specPaths] of inverseIndex) {
    // SKIPPED takes priority — check skip-list before computing verdict
    if (skipSet.has(cell)) {
      result.set(cell, "SKIPPED");
      continue;
    }

    // Accumulate contribution from every spec in the inverse set.
    // Start at GREEN; any non-PASS contribution can only raise the level.
    let cellVerdict: CellVerdict = "GREEN";

    for (const specPath of specPaths) {
      const verdict = reporterVerdicts[specPath];
      const contribution: CellVerdict =
        verdict == null
          ? "UNKNOWN" // missing — fail-closed: absence ≠ PASS
          : statusToContribution(verdict.status);

      cellVerdict = dominates(cellVerdict, contribution);

      // RED is the ceiling — short-circuit
      if (cellVerdict === "RED") {
        break;
      }
    }

    result.set(cell, cellVerdict);
  }

  return result;
}

/**
 * Compute data-model diagnostics for a single integration slug without
 * altering the verdict contract.
 *
 * Callers (the CI guard, the CLI) can assert on diagnostics to catch
 * inconsistencies that `rollupVerdicts` cannot surface through its return
 * value alone:
 *
 *   inertSkipEntries — skip-list cells that match no cell in the inverse
 *                      index. After G1 fix these are still emitted as SKIPPED
 *                      in the verdict map; this diagnostic flags that their
 *                      skip declaration has no spec backing (likely stale
 *                      skip-list or missing mapping entry).
 *
 *   skipMaskedRed    — skip-listed cells whose specs actually ran and produced
 *                      a FAIL verdict. Requires the optional `reporterVerdicts`
 *                      argument; returns [] when omitted (backward-compat).
 *                      The SKIPPED verdict itself is NOT changed — governance
 *                      stays with the skip-list — but callers can alert that
 *                      a skip is hiding an active regression.
 *
 * @param slug             - Integration slug (used only for the skip-list lookup).
 * @param slugMapping      - RESOLVED per-slug mapping (spec-path → cells),
 *                           already resolved by loadSpecCellMapping(slug, deps).
 * @param skipList         - Skip-list map (slug → D5FeatureType strings).
 * @param reporterVerdicts - Optional per-spec verdict map; required for
 *                           skipMaskedRed computation.
 * @returns RollupDiagnostics for this slug.
 */
export function rollupDiagnostics(
  slug: string,
  slugMapping: ResolvedSlugMapping,
  skipList: Readonly<Record<string, readonly string[]>>,
  reporterVerdicts?: ReporterVerdictMap,
): RollupDiagnostics {
  if (slugMapping == null) {
    // Empty resolved map — skip-list entries have nothing to cross-reference.
    return { inertSkipEntries: [], skipMaskedRed: [] };
  }

  const skipEntries = skipList[slug] ?? [];
  const skipSet = new Set<string>(skipEntries);
  const { inverseIndex, inertSkipEntries } = buildInverseIndex(
    slugMapping,
    skipEntries,
  );

  // G2 fix: compute skipMaskedRed — skip-listed cells that would be RED
  // if the skip were lifted (i.e. their specs ran and actually FAILED).
  const skipMaskedRed: D5FeatureType[] = [];
  if (reporterVerdicts != null) {
    for (const [cell, specPaths] of inverseIndex) {
      if (!skipSet.has(cell)) continue; // only check skipped cells

      // Check if any spec for this cell produced a FAIL
      for (const specPath of specPaths) {
        const verdict = reporterVerdicts[specPath];
        if (verdict != null && verdict.status === "FAIL") {
          skipMaskedRed.push(cell);
          break; // one FAIL is enough to flag the cell
        }
      }
    }
  }

  return { inertSkipEntries, skipMaskedRed };
}
