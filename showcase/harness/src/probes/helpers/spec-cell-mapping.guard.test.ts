/**
 * spec-cell-mapping CI guard — red-green test suite.
 *
 * Verifies five invariants PER FLAGGED SLUG ONLY (unflagged slugs are
 * exempt; an empty `spec-driven-slugs.json` leaves the guard dormant):
 *
 *   1. COMPLETENESS  — every expected cell (slug's D5FeatureType inventory
 *                      derived from an INDEPENDENT source: the feature
 *                      registry manifest via demosToFeatureTypes, minus
 *                      skip-list) has ≥1 mapped spec in the inverse index.
 *   2. UNIQUENESS    — (a) no orphan spec (a mapped spec path maps to zero
 *                      cells) and (b) every mapped cell is a real
 *                      D5FeatureType.
 *   3. FILE-EXISTENCE — every mapped spec path exists on disk under the
 *                      integration root.
 *   4. CONSISTENCY   — no cell is both mapped AND in the skip-list (a
 *                      mapped+skipped cell is a contradiction: the spec
 *                      claims to certify the cell while the skip-list
 *                      declares it unsupported).
 *   5. DRIFT         — every skip-list.json cell for a flagged slug must
 *                      still be present in that slug's manifest
 *                      `not_supported_features`. If a cell is un-quarantined
 *                      from the manifest but left in skip-list.json, the
 *                      stale entry silently masks the cell (it would be
 *                      excluded from COMPLETENESS as if still quarantined).
 *                      The DRIFT guard fires `stale-skip-list-entry` instead,
 *                      forcing the skip-list to be updated in lockstep.
 *                      Only checked when `getManifestNsf` is supplied.
 *
 * COMPLETENESS CHECK IS NOT TAUTOLOGICAL:
 *   `getExpectedCells` is supplied by the CALLER and must come from a source
 *   INDEPENDENT of the mapping under audit. For the LGP live-mapping GREEN
 *   test (case c/live) this is `demosToFeatureTypes(LGP_MANIFEST_FEATURES)`
 *   computed from the integration's manifest feature list — NOT derived from
 *   the mapping JSON itself. This means a cell that is in the registry but
 *   missing from the mapping WILL trigger an uncovered-cell finding.
 *
 * RED-GREEN FIXTURES (§3 Task 2.2 of impl plan):
 *   The shipped `spec-driven-slugs.json` is EMPTY so the guard is dormant
 *   with the real flag file.  Tests use
 *   `__overrideSpecDrivenSlugsForTesting` to inject a test-scoped flag list
 *   so each fixture exercises the guard against a synthetic slug.
 *
 *   (a) Orphaned spec → guard FAILS                    (RED → GREEN proof)
 *   (b) Uncovered expected cell → guard FAILS          (RED → GREEN proof)
 *   (c) Reconciled mapping → guard PASSES              (GREEN)
 *   (d) Real (empty) flag file → guard PASSES          (dormant GREEN)
 *   (e) Mapped+skipped contradiction → guard FAILS     (RED → GREEN proof)
 *   (f) Registry cell missing from mapping → FAILS     (RED → GREEN proof;
 *       proves COMPLETENESS is non-tautological)
 *   (g) Non-flagged slug with mapping → not audited    (strengthened fixture)
 *   (h) Stale skip-list entry (not in manifest NSF) → FAILS  (RED → GREEN
 *       drift guard; J3-Fix3)
 *   (j) Mapped cell not in expected set → FAILS        (RED → GREEN proof;
 *       INVERSE-COMPLETENESS, Invariant 6 / unexpected-mapped-cell)
 *
 * INVERSE-COMPLETENESS (Invariant 6):
 *   For each flagged slug, every cell that appears in the mapping's cell
 *   arrays must be a member of the slug's expected set (getExpectedCells).
 *   Without this check, a cell retired from the manifest can persist in the
 *   mapping and be silently emitted by d6-rollup — weakening the fail-closed
 *   invariant. Skip-listed cells are EXEMPT from this check: if a cell is
 *   skip-listed it is already known to be outside the normal expected set
 *   (e.g. quarantined entries). The CONSISTENCY invariant (Invariant 4:
 *   mapped-and-skipped) already fires if a cell is both mapped and
 *   skip-listed, so skip-listing does not provide a loophole here.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { SpecCellMapping, SlugDelta } from "./spec-cell-mapping.js";
import {
  __overrideSpecCellMappingForTesting,
  __overrideSpecCellDeltaForTesting,
} from "./spec-cell-mapping.js";
import {
  __overrideSpecDrivenSlugsForTesting,
  __getSpecDrivenSlugsForTesting,
} from "./spec-driven-slugs.js";
import { isD5FeatureType, type D5FeatureType } from "./d5-registry.js";
import { demosToFeatureTypes } from "./d5-feature-mapping.js";
import {
  loadSkipList,
  __overrideSkipListForTesting,
  type SkipListMap,
} from "./skip-list.js";
import SEEDED_MAPPING from "./spec-cell-mapping.json" with { type: "json" };

// ── guard implementation ─────────────────────────────────────────────────────

/**
 * A single guard finding.  `kind` identifies the invariant that failed;
 * `slug`, `spec`, and `cell` narrow the site of the violation.
 */
export interface GuardFinding {
  kind:
    | "uncovered-cell" // COMPLETENESS: expected cell has no mapped specs
    | "orphan-spec" // UNIQUENESS:   mapped spec path maps to zero cells
    | "invalid-cell" // UNIQUENESS:   mapped cell is not a D5FeatureType
    | "missing-file" // FILE-EXISTENCE: spec path absent on disk
    | "mapped-and-skipped" // CONSISTENCY: cell is both mapped and in skip-list
    | "stale-skip-list-entry" // DRIFT: skip-list cell no longer in manifest NSF
    | "unexpected-mapped-cell" // INVERSE-COMPLETENESS: mapped cell not in expected set
    | "unmapped-onDisk-spec" // COVERAGE-HOLE (advisory WARN): on-disk spec whose stem has no base cell + no override
    | "delta-collision"; // DELTA: override without `force` contradicts a DIFFERENT base cell
  slug: string;
  /** Populated for spec-anchored findings (orphan-spec, missing-file, unmapped-onDisk-spec). */
  spec?: string;
  /** Populated for cell-anchored findings (uncovered-cell, invalid-cell, mapped-and-skipped, stale-skip-list-entry, delta-collision). */
  cell?: string;
}

/**
 * Options accepted by `runMappingGuard`.  All dependencies are injected so
 * the function is pure and unit-testable without touching the live filesystem
 * or the shipped JSON files.
 */
export interface MappingGuardOptions {
  /**
   * The RESOLVED per-slug mapping to audit. Under the base+delta model this is
   * the output of `loadSpecCellMapping(slug, deps)` (base ⊕ override ⊖ auto-omit,
   * restricted to on-disk specs), keyed as `{ [slug]: { specPath: cells } }`.
   * Fixtures inject a synthetic already-resolved map directly. `mapping[slug]`
   * is the resolved slug map — the guard never resolves internally.
   */
  mapping: SpecCellMapping;

  /**
   * The list of slugs currently in `spec-driven-slugs.json`
   * (or the test override).  Only slugs in this list are audited.
   */
  flaggedSlugs: string[];

  /**
   * Returns the set of D5FeatureType cells that a slug is expected to
   * cover.  MUST be derived from a source INDEPENDENT of the mapping
   * under audit — typically `demosToFeatureTypes(manifest.features)` for
   * the slug's feature registry entry.  Using the mapping itself as the
   * source makes the COMPLETENESS check tautological (an uncovered cell
   * can never fire if expected cells are seeded FROM the mapping).
   *
   * For the live LGP test this is `demosToFeatureTypes(LGP_MANIFEST_FEATURES)`
   * computed from the integration's `manifest.yaml` features array.
   */
  getExpectedCells: (slug: string) => D5FeatureType[];

  /**
   * Active skip-list — cells in `skipList[slug]` are excluded from the
   * COMPLETENESS check (they are allowed to have no mapped spec).
   */
  skipList: SkipListMap;

  /**
   * Resolves a relative spec path to an absolute path for the
   * FILE-EXISTENCE check.  Injectable for tests; the live guard uses
   * a closure over the integration root directory.
   */
  resolveSpecPath: (slug: string, specPath: string) => string;

  /**
   * Predicate for path existence — injectable so tests can run without
   * touching the real filesystem.  Defaults to `fs.existsSync`.
   */
  fileExists?: (absPath: string) => boolean;

  /**
   * Returns the manifest `not_supported_features` array for a slug —
   * the authoritative source of truth for which cells are legitimately
   * quarantined. Used by the DRIFT guard (Invariant 5).
   *
   * When absent (undefined), the DRIFT guard is skipped (backward-compatible
   * default: callers that do not supply this cannot fire stale-skip-list-entry).
   *
   * For the live LGP test this is `LGP_MANIFEST.not_supported_features`.
   */
  getManifestNsf?: (slug: string) => string[];

  /**
   * On-disk spec relpaths for a slug whose stem has NO base cell and NO
   * override — i.e. the resolver's `unmapped-onDisk-spec` WARN sink surfaced
   * (or a re-scan). Each yields an advisory `unmapped-onDisk-spec` finding.
   *
   * Advisory only: the guard does NOT fail the gate on these (the spec still
   * runs, it just feeds no cell). When absent, no such finding is emitted.
   */
  getUnmappedOnDiskSpecs?: (slug: string) => string[];

  /**
   * The per-slug delta (`SlugDelta`) for the `delta-collision` (RED) check.
   * A `delta.overrides[stem]` WITHOUT `force` whose stem already has a base
   * cell for a DIFFERENT cell silently contradicts the base — the guard fires
   * `delta-collision`. When either `getDelta` or `getBaseCell` is absent the
   * collision check is skipped (backward-compatible).
   */
  getDelta?: (slug: string) => SlugDelta | undefined;

  /**
   * The base cell(s) for a stem (from base.json) — paired with `getDelta` for
   * the `delta-collision` check.
   */
  getBaseCell?: (stem: string) => readonly string[] | undefined;
}

/**
 * Run the six-invariant mapping guard against all flagged slugs.
 *
 * Returns an array of `GuardFinding` objects — one per violation.
 * An empty array means the guard is GREEN for all flagged slugs.
 *
 * The function is deliberately pure and has no side-effects.  It does NOT
 * throw on violations; callers (or test assertions) inspect the returned
 * findings.
 *
 * Invariant 5 (DRIFT): when `getManifestNsf` is provided, every cell in
 * `skipList[slug]` must still appear in the slug's manifest
 * `not_supported_features`. If a cell was un-quarantined from the manifest
 * but left in skip-list.json, the guard fires `stale-skip-list-entry` so
 * the stale entry cannot silently mask a cell that should now be tested.
 *
 * Invariant 6 (INVERSE-COMPLETENESS): for each flagged slug, every cell
 * appearing in the mapping must be a member of the slug's expected set
 * (getExpectedCells). Skip-listed cells are exempt — they are intentionally
 * outside the expected set and the CONSISTENCY invariant already fires if
 * a cell is both mapped and skip-listed. A violation fires
 * `unexpected-mapped-cell` so retired cells cannot persist silently in the
 * mapping and be emitted by d6-rollup as phantom verdicts.
 */
export function runMappingGuard(opts: MappingGuardOptions): GuardFinding[] {
  const {
    mapping,
    flaggedSlugs,
    getExpectedCells,
    skipList,
    resolveSpecPath,
    fileExists = existsSync,
    getManifestNsf,
    getUnmappedOnDiskSpecs,
    getDelta,
    getBaseCell,
  } = opts;

  const findings: GuardFinding[] = [];

  for (const slug of flaggedSlugs) {
    const slugMapping = mapping[slug] ?? {};
    const skippedCells = new Set<string>(skipList[slug] ?? []);

    // Build inverse index: cell → set of spec paths that map to it.
    const inverseIndex = new Map<string, string[]>();
    for (const [specPath, cells] of Object.entries(slugMapping)) {
      for (const cell of cells) {
        const existing = inverseIndex.get(cell) ?? [];
        existing.push(specPath);
        inverseIndex.set(cell, existing);
      }
    }

    // ── UNIQUENESS (b): every mapped cell is a real D5FeatureType ─────────
    for (const [specPath, cells] of Object.entries(slugMapping)) {
      for (const cell of cells) {
        if (!isD5FeatureType(cell)) {
          findings.push({ kind: "invalid-cell", slug, spec: specPath, cell });
        }
      }
    }

    // ── UNIQUENESS (a): no orphan spec (mapped spec path → zero cells) ────
    for (const [specPath, cells] of Object.entries(slugMapping)) {
      if (cells.length === 0) {
        findings.push({ kind: "orphan-spec", slug, spec: specPath });
      }
    }

    // ── FILE-EXISTENCE: every mapped spec path exists on disk ─────────────
    for (const specPath of Object.keys(slugMapping)) {
      const absPath = resolveSpecPath(slug, specPath);
      if (!fileExists(absPath)) {
        findings.push({ kind: "missing-file", slug, spec: specPath });
      }
    }

    // ── CONSISTENCY: no cell is both mapped AND in the skip-list ──────────
    //
    // A cell appearing in both the mapping and the skip-list is
    // contradictory: the mapping claims a spec certifies the cell while
    // the skip-list declares it unsupported headless. One of these must
    // be wrong and the contradiction must be surfaced explicitly rather
    // than resolved silently (the SKIPPED verdict would quietly hide it).
    for (const cell of inverseIndex.keys()) {
      if (skippedCells.has(cell)) {
        findings.push({ kind: "mapped-and-skipped", slug, cell });
      }
    }

    // ── COMPLETENESS: every expected cell (minus skip-list) is covered ────
    //
    // IMPORTANT: `getExpectedCells` MUST be derived from a source
    // independent of `mapping` (e.g. demosToFeatureTypes(manifest.features)).
    // Using the mapping as the source makes this check tautological:
    // a cell absent from the mapping would never appear in expectedCells,
    // so the guard could never fire for a missing cell.
    const expectedCells = getExpectedCells(slug);
    for (const cell of expectedCells) {
      if (skippedCells.has(cell)) continue;
      const specsForCell = inverseIndex.get(cell) ?? [];
      if (specsForCell.length === 0) {
        findings.push({ kind: "uncovered-cell", slug, cell });
      }
    }

    // ── INVERSE-COMPLETENESS (Invariant 6): every mapped cell must be expected ─
    //
    // The COMPLETENESS invariant (Invariant 1) checks that every expected
    // cell is covered by a mapped spec.  The INVERSE-COMPLETENESS invariant
    // checks the other direction: every cell that appears in the mapping must
    // be a member of the slug's expected set.
    //
    // Without this check, a feature retired from the manifest can persist in
    // spec-cell-mapping.json and be silently emitted by d6-rollup — a
    // mapped-but-no-longer-expected cell would produce a phantom verdict for a
    // cell that is no longer in the registry, undermining the fail-closed
    // invariant this PR establishes.
    //
    // Skip-list interaction: skip-listed cells are EXEMPT from this check.
    // A skip-listed cell is quarantined — it is intentionally absent from the
    // expected set — so its presence in the mapping would correctly fire
    // CONSISTENCY (mapped-and-skipped) rather than INVERSE-COMPLETENESS.
    // Exempting skip-listed cells avoids a duplicate finding for the same
    // underlying contradiction while preserving the invariant's intent.
    const expectedCellsSet = new Set<string>(expectedCells);
    for (const [specPath, cells] of Object.entries(slugMapping)) {
      for (const cell of cells) {
        if (skippedCells.has(cell)) continue; // exempt: CONSISTENCY already fires
        if (!expectedCellsSet.has(cell)) {
          findings.push({
            kind: "unexpected-mapped-cell",
            slug,
            spec: specPath,
            cell,
          });
        }
      }
    }

    // ── DRIFT (Invariant 5): skip-list ↔ manifest NSF consistency ─────────
    //
    // Every cell in skip-list.json[slug] must still appear in the slug's
    // manifest `not_supported_features`. If a cell was un-quarantined from
    // the manifest (removed from not_supported_features) but left in
    // skip-list.json, it silently masks a cell that should now be exercised
    // by a spec. This guard makes that drift visible: a stale skip-list
    // entry FAILS the guard instead of quietly hiding the cell.
    //
    // This invariant is only checked when `getManifestNsf` is provided
    // (backward-compatible: existing callers without it skip Invariant 5).
    if (getManifestNsf !== undefined) {
      const manifestNsf = new Set<string>(getManifestNsf(slug));
      for (const cell of skippedCells) {
        if (!manifestNsf.has(cell)) {
          findings.push({ kind: "stale-skip-list-entry", slug, cell });
        }
      }
    }

    // ── COVERAGE-HOLE (advisory): unmapped on-disk spec → WARN, never silent ──
    //
    // An on-disk spec whose stem has no base cell and no override runs but
    // feeds no dashboard cell. Surface it as an advisory `unmapped-onDisk-spec`
    // finding so the hole is visible in CI. This does NOT fail the gate — the
    // spec still runs; it simply certifies nothing. (agentic-chat-reasoning on
    // 7 slugs, shared-state-write before its alias, etc.)
    if (getUnmappedOnDiskSpecs !== undefined) {
      for (const spec of getUnmappedOnDiskSpecs(slug)) {
        findings.push({ kind: "unmapped-onDisk-spec", slug, spec });
      }
    }

    // ── DELTA-COLLISION (RED): override without `force` contradicts base ─────
    //
    // A `delta.overrides[stem]` is permitted when the stem has NO base cell
    // (supplies a missing cell) or is `force`d (deliberately re-maps). An
    // override that silently re-maps a base-mapped stem to a DIFFERENT cell
    // WITHOUT `force` is a delta-collision — the two disagree and one is wrong.
    if (getDelta !== undefined && getBaseCell !== undefined) {
      const delta = getDelta(slug);
      const overrides = delta?.overrides ?? {};
      for (const [stem, ov] of Object.entries(overrides)) {
        if (ov.force) continue; // deliberate re-map is allowed
        const baseCells = getBaseCell(stem);
        if (baseCells === undefined || baseCells.length === 0) continue; // no base cell → supplies a missing cell, fine
        // Base has a cell for this stem AND the override differs (not force) → collision.
        const baseSet = new Set<string>(baseCells);
        const sameAsBase =
          ov.cells.length === baseCells.length &&
          ov.cells.every((c) => baseSet.has(c));
        if (!sameAsBase) {
          for (const cell of ov.cells) {
            findings.push({ kind: "delta-collision", slug, cell });
          }
        }
      }
    }
  }

  return findings;
}

// ── helpers for the tests below ──────────────────────────────────────────────

/**
 * Resolve a spec path under `showcase/integrations/<slug>/`.
 * Used by the live-mapping GREEN test (case c/d with real files).
 */
const INTEGRATIONS_ROOT = resolve(__dirname, "../../../../integrations");

function liveResolveSpec(slug: string, specPath: string): string {
  return resolve(INTEGRATIONS_ROOT, slug, specPath);
}

/**
 * Read the LGP manifest features array at TEST TIME directly from the real
 * `showcase/integrations/langgraph-python/manifest.yaml` file.
 *
 * This replaces the former hand-copied literal which could silently drift
 * from the real manifest, defeating the "independent source" invariant that
 * makes the COMPLETENESS check non-tautological.
 *
 * Only the `features:` block is extracted — `not_supported_features` entries
 * are intentionally excluded (they appear in the skip-list instead and are
 * not expected to be mapped). The `not_supported_features` block is read
 * separately to populate the skip-list for the live guard test (case c).
 *
 * Drift detection: a sentinel assertion in the live-mapping test (case c)
 * compares the parsed feature count against the expected count so that a
 * manifest update that removes or adds features causes an immediate test
 * failure rather than a silent drift.
 */
const LGP_MANIFEST_PATH = resolve(
  __dirname,
  "../../../../integrations/langgraph-python/manifest.yaml",
);

interface LgpManifest {
  features?: string[];
  not_supported_features?: string[];
}

function readLgpManifest(): LgpManifest {
  const raw = readFileSync(LGP_MANIFEST_PATH, "utf-8");
  const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as LgpManifest;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Failed to parse ${LGP_MANIFEST_PATH} as YAML object`);
  }
  return parsed;
}

/**
 * The LGP manifest parsed at test time — INDEPENDENT of spec-cell-mapping.json.
 * Using this as the expected-cell source means a cell in the manifest but
 * absent from the mapping will fire an uncovered-cell finding. A hand-copied
 * literal would silently drift and the check would become tautological.
 */
const LGP_MANIFEST = readLgpManifest();
const LGP_MANIFEST_FEATURES: readonly string[] = LGP_MANIFEST.features ?? [];

/**
 * Sentinel: the number of features we expect to see in the manifest.
 * Update this constant when features are intentionally added or removed
 * from langgraph-python/manifest.yaml. The test will catch unintentional
 * drift (e.g. a feature silently removed from the YAML without a matching
 * mapping update).
 *
 * Current count as of 2026-07-07: 38 features in the `features:` block.
 * (gen-ui-interrupt and interrupt-headless are in not_supported_features,
 * not counted here.)
 */
const LGP_MANIFEST_FEATURES_EXPECTED_COUNT = 38;

/**
 * Expected D5 cells for LGP, derived from the manifest features via the
 * INDEPENDENT mapping table (demosToFeatureTypes).  Replacing the old
 * LGP_MAPPED_CELLS constant which was derived from the spec-cell-mapping.json
 * itself — making the completeness check tautological.
 */
const LGP_EXPECTED_CELLS: D5FeatureType[] = demosToFeatureTypes(
  LGP_MANIFEST_FEATURES,
);

// ── test suite ────────────────────────────────────────────────────────────────

describe("spec-cell-mapping CI guard", () => {
  afterEach(() => {
    // Restore the real (empty) flag file and all module-level overrides after
    // each test so parallel multi-file runs cannot leak state across files.
    __overrideSpecCellMappingForTesting(undefined);
    __overrideSpecCellDeltaForTesting(undefined);
    __overrideSpecDrivenSlugsForTesting(undefined);
    __overrideSkipListForTesting(undefined);
  });

  // ── case (a): orphaned spec → guard FAILS ─────────────────────────────────
  describe("(a) orphaned spec — a mapped spec path maps to zero cells", () => {
    it("reports an orphan-spec finding when a spec entry has an empty cell array", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // Mapping with one well-formed entry and one orphaned spec.
      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
          "tests/e2e/orphan.spec.ts": [], // ← orphaned: empty cell list
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat"],
        skipList: {},
        resolveSpecPath: () => "/nonexistent-but-irrelevant",
        fileExists: () => true, // bypass FILE-EXISTENCE for this fixture
      });

      const orphan = findings.filter((f) => f.kind === "orphan-spec");
      expect(orphan).toHaveLength(1);
      expect(orphan[0].slug).toBe(TEST_SLUG);
      expect(orphan[0].spec).toBe("tests/e2e/orphan.spec.ts");
    });
  });

  // ── case (b): uncovered expected cell → guard FAILS ───────────────────────
  describe("(b) uncovered flagged cell — expected cell has no mapped spec", () => {
    it("reports an uncovered-cell finding when an expected cell is absent from the inverse index", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // Mapping covers "agentic-chat" but NOT "auth" — guard must report it.
      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
          // auth is missing
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat", "auth"], // auth expected but missing
        skipList: {},
        resolveSpecPath: () => "/nonexistent-but-irrelevant",
        fileExists: () => true,
      });

      const uncovered = findings.filter((f) => f.kind === "uncovered-cell");
      expect(uncovered).toHaveLength(1);
      expect(uncovered[0].slug).toBe(TEST_SLUG);
      expect(uncovered[0].cell).toBe("auth");
    });

    it("does NOT report an uncovered-cell finding when the cell is in the skip-list", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
          // auth is missing from mapping — but it is in the skip-list
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat", "auth"],
        skipList: { [TEST_SLUG]: ["auth"] }, // auth is skipped → no finding
        resolveSpecPath: () => "/nonexistent-but-irrelevant",
        fileExists: () => true,
      });

      const uncovered = findings.filter((f) => f.kind === "uncovered-cell");
      expect(uncovered).toHaveLength(0);
    });
  });

  // ── case (c): reconciled mapping → guard PASSES ───────────────────────────
  describe("(c) reconciled mapping — all invariants satisfied", () => {
    it("returns zero findings when mapping, expected cells, and files are all consistent", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // Minimal well-formed mapping: two specs, two cells, all covered.
      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
          "tests/e2e/auth.spec.ts": ["auth"],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat", "auth"],
        skipList: {},
        resolveSpecPath: (_slug, specPath) => `/fake-root/${specPath}`,
        fileExists: () => true, // all files "exist"
      });

      expect(findings).toHaveLength(0);
    });

    it("returns zero findings for the full seeded langgraph-python mapping against real spec files", () => {
      // This test exercises the live seeded mapping (spec-cell-mapping.json)
      // against the real langgraph-python spec files on disk.  The slug is
      // NOT in the real spec-driven-slugs.json (empty), so we inject it.
      __overrideSpecDrivenSlugsForTesting(["langgraph-python"]);

      // Load the seeded mapping directly from the JSON file (static import at top).
      const rawMapping = SEEDED_MAPPING as unknown as SpecCellMapping;

      // ── Sentinel: verify the manifest features count matches our expectation.
      // This catches unintentional drift where a feature is silently added or
      // removed from manifest.yaml without a corresponding mapping update.
      // If this assertion fires, update LGP_MANIFEST_FEATURES_EXPECTED_COUNT
      // AND the mapping (spec-cell-mapping.json) to reflect the real manifest.
      expect(LGP_MANIFEST_FEATURES.length).toBe(
        LGP_MANIFEST_FEATURES_EXPECTED_COUNT,
      );

      // Expected cells from the INDEPENDENT source: manifest.yaml features
      // READ AT TEST TIME (not a hand-copied literal) translated via
      // demosToFeatureTypes (NOT derived from the mapping JSON).
      // gen-ui-interrupt and interrupt-headless are in not_supported_features
      // (quarantined) so they are absent from features[] and thus from
      // LGP_EXPECTED_CELLS. They appear in the REAL skip-list.json (read below)
      // so the guard skips them from COMPLETENESS.
      const manifestNsf: string[] = LGP_MANIFEST.not_supported_features ?? [];

      // DRIFT-guard independence fix (R6-LB INVARIANT-5):
      // skipList MUST be read from the REAL shipped skip-list.json — NOT constructed
      // from the manifest NSF. Building skipList from manifest NSF makes the DRIFT
      // guard tautological: it compares skipList against getManifestNsf, both derived
      // from the same source, so a stale skip-list entry (cell removed from manifest
      // NSF but left in skip-list.json) can never fire. Reading from the real
      // skip-list.json makes the DRIFT guard actually independent: if skip-list.json
      // has a cell that is no longer in manifest.yaml not_supported_features, the
      // guard fires stale-skip-list-entry.
      const realSkipList: SkipListMap = loadSkipList();

      const findings = runMappingGuard({
        mapping: rawMapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => LGP_EXPECTED_CELLS,
        skipList: realSkipList,
        resolveSpecPath: liveResolveSpec,
        fileExists: existsSync,
        // DRIFT guard: use real manifest NSF as the authority — INDEPENDENT of
        // the skipList above (which comes from skip-list.json). Future drift
        // (skip-list.json entry removed from manifest NSF) will fire here.
        getManifestNsf: () => manifestNsf,
      });

      // Report any findings clearly before the assertion.
      if (findings.length > 0) {
        const report = findings
          .map(
            (f) =>
              `  [${f.kind}] slug=${f.slug}${f.spec ? ` spec=${f.spec}` : ""}${f.cell ? ` cell=${f.cell}` : ""}`,
          )
          .join("\n");
        throw new Error(
          `Guard found ${findings.length} violation(s):\n${report}`,
        );
      }

      expect(findings).toHaveLength(0);
    });
  });

  // ── case (d): real (empty) flag file → guard dormant, GREEN ──────────────
  describe("(d) real empty flag file — guard is dormant", () => {
    it("returns zero findings when spec-driven-slugs.json has no flagged slugs", () => {
      // Restore to the real file state (the override was cleared in afterEach;
      // this test also explicitly verifies the real file is empty).
      __overrideSpecDrivenSlugsForTesting(undefined);

      const realFlaggedSlugs = __getSpecDrivenSlugsForTesting();

      // Phase-0 invariant: the real flag file must be empty.
      expect(realFlaggedSlugs).toHaveLength(0);

      // Guard with no flagged slugs — zero iterations, zero findings.
      const findings = runMappingGuard({
        mapping: {},
        flaggedSlugs: realFlaggedSlugs,
        getExpectedCells: () => [],
        skipList: {},
        resolveSpecPath: () => "/should-never-be-called",
        fileExists: () => false, // would fail if called — proves it is not
      });

      expect(findings).toHaveLength(0);
    });
  });

  // ── case (e): mapped-and-skipped contradiction → guard FAILS ─────────────
  describe("(e) CONSISTENCY — mapped+skipped contradiction", () => {
    it("reports a mapped-and-skipped finding when a cell appears in both the mapping and the skip-list", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // "auth" is both mapped to a spec AND declared skipped — contradiction.
      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/auth.spec.ts": ["auth"],
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat", "auth"],
        skipList: { [TEST_SLUG]: ["auth"] }, // auth skipped but also mapped
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      const contradictions = findings.filter(
        (f) => f.kind === "mapped-and-skipped",
      );
      expect(contradictions).toHaveLength(1);
      expect(contradictions[0].slug).toBe(TEST_SLUG);
      expect(contradictions[0].cell).toBe("auth");
    });

    it("does NOT report mapped-and-skipped when the cell is mapped but NOT in skip-list", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/auth.spec.ts": ["auth"],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["auth"],
        skipList: {}, // no skip-list entries
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      const contradictions = findings.filter(
        (f) => f.kind === "mapped-and-skipped",
      );
      expect(contradictions).toHaveLength(0);
    });
  });

  // ── case (f): registry cell missing from mapping → FAILS (non-tautological) ─
  describe("(f) COMPLETENESS is non-tautological — independent expected-cell source", () => {
    it("fires an uncovered-cell finding when a cell is in the registry but absent from the mapping", () => {
      // This test proves the completeness check is NOT tautological.
      // getExpectedCells comes from an INDEPENDENT source (the registry /
      // demosToFeatureTypes), not from the mapping itself.  A cell present
      // in the registry but absent from the mapping must fire.
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // The mapping covers "agentic-chat" only.
      // The INDEPENDENT registry says this slug should also cover "auth".
      // The guard must fire for "auth" even though iterating mapping keys
      // would never surface it.
      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
          // auth is NOT in the mapping
        },
      };

      // Independent registry source: "auth" is expected but not mapped.
      const independentExpectedCells: D5FeatureType[] = [
        "agentic-chat",
        "auth",
      ];

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        // INDEPENDENT source — NOT derived from mapping keys
        getExpectedCells: () => independentExpectedCells,
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      const uncovered = findings.filter((f) => f.kind === "uncovered-cell");
      expect(uncovered).toHaveLength(1);
      expect(uncovered[0].cell).toBe("auth");
    });
  });

  // ── additional UNIQUENESS edge-cases ──────────────────────────────────────
  describe("UNIQUENESS — invalid D5FeatureType cell string", () => {
    it("reports an invalid-cell finding when a mapped cell is not a known D5FeatureType", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // "not-a-real-feature-type" is not in the D5FeatureType union.
      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": [
            "agentic-chat",
            "not-a-real-feature-type" as D5FeatureType,
          ],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat"],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      const invalid = findings.filter((f) => f.kind === "invalid-cell");
      expect(invalid).toHaveLength(1);
      expect(invalid[0].cell).toBe("not-a-real-feature-type");
    });
  });

  describe("FILE-EXISTENCE — missing spec file on disk", () => {
    it("reports a missing-file finding when a mapped spec path does not exist on disk", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/exists.spec.ts": ["agentic-chat"],
          "tests/e2e/does-not-exist.spec.ts": ["auth"],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat", "auth"],
        skipList: {},
        resolveSpecPath: (_slug, specPath) => `/fake/${specPath}`,
        fileExists: (absPath) => absPath.endsWith("exists.spec.ts"),
      });

      const missing = findings.filter((f) => f.kind === "missing-file");
      expect(missing).toHaveLength(1);
      expect(missing[0].spec).toBe("tests/e2e/does-not-exist.spec.ts");
    });
  });

  // ── case (g): unflagged slugs exempt — strengthened fixture ───────────────
  describe("(g) unflagged slugs — exempt from guard (strengthened)", () => {
    it("does NOT audit a slug not in the flagged list, even if it has mapping entries that would produce findings", () => {
      // "langgraph-python" has mapping entries for "agentic-chat".
      // "some-other-slug" IS flagged but has NO mapping entry.
      // getExpectedCells returns ["agentic-chat"] for "some-other-slug"
      // — which IS absent from its mapping → would fire uncovered-cell
      // if the guard incorrectly iterated over ALL mapping keys.
      //
      // This fixture proves the guard iterates `flaggedSlugs`, NOT
      // `Object.keys(mapping)`. If it iterated mapping keys, "langgraph-python"
      // would be audited (an unflagged slug) and produce zero findings
      // (its mapping is consistent), masking the regression. By making
      // "some-other-slug" flagged with an expected cell that it DOESN'T
      // map, any iteration of mapping keys instead of flaggedSlugs would
      // produce zero findings for the wrong reason. The stub guard here
      // only produces findings for cells expected on "some-other-slug".
      __overrideSpecDrivenSlugsForTesting(["some-other-slug"]);

      const mapping: SpecCellMapping = {
        "langgraph-python": {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
        },
        // "some-other-slug" has no mapping entry
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        // "some-other-slug" expects "agentic-chat" — NOT in its mapping
        // If the guard iterated mapping keys it would audit LGP (not flagged)
        // and find zero issues, but would NOT audit "some-other-slug"
        // (which IS flagged). The correct implementation audits only
        // flaggedSlugs, so "some-other-slug" with no mapping → uncovered-cell.
        getExpectedCells: (slug) =>
          slug === "some-other-slug" ? ["agentic-chat"] : [],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      // "langgraph-python" is NOT flagged, so it must NOT appear in findings.
      const lgpFindings = findings.filter((f) => f.slug === "langgraph-python");
      expect(lgpFindings).toHaveLength(0);

      // "some-other-slug" IS flagged, has no mapping, has "agentic-chat"
      // as an expected cell → uncovered-cell finding.
      const slugFindings = findings.filter((f) => f.slug === "some-other-slug");
      expect(slugFindings).toHaveLength(1);
      expect(slugFindings[0].kind).toBe("uncovered-cell");
      expect(slugFindings[0].cell).toBe("agentic-chat");
    });
  });

  // ── case (h): skip-list ↔ manifest NSF drift guard (J3-Fix3) ─────────────
  //
  // Invariant 5: every skip-list.json cell for a flagged slug must still
  // appear in that slug's manifest not_supported_features. If a cell is
  // un-quarantined from the manifest (removed from NSF) but left in
  // skip-list.json, the stale entry silently masks the cell from COMPLETENESS.
  // The drift guard fires stale-skip-list-entry to force lockstep updates.
  describe("(h) DRIFT — stale skip-list entry not in manifest NSF → guard FAILS", () => {
    it("RED: stale skip-list cell (not in manifest NSF) fires stale-skip-list-entry", () => {
      // "gen-ui-interrupt" is in skip-list but was removed from manifest NSF.
      // Without this guard, COMPLETENESS silently skips it as if still quarantined.
      // With the guard, the stale entry surfaces as a finding.
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat"],
        // skip-list claims "gen-ui-interrupt" is quarantined…
        skipList: { [TEST_SLUG]: ["gen-ui-interrupt"] },
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        // …but the manifest NSF no longer contains it (un-quarantined).
        getManifestNsf: () => [],
      });

      const drift = findings.filter((f) => f.kind === "stale-skip-list-entry");
      expect(drift).toHaveLength(1);
      expect(drift[0].slug).toBe(TEST_SLUG);
      expect(drift[0].cell).toBe("gen-ui-interrupt");
    });

    it("GREEN: skip-list cell still in manifest NSF → no drift finding", () => {
      // The cell is in both skip-list AND manifest NSF — consistent, no finding.
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat"],
        skipList: { [TEST_SLUG]: ["gen-ui-interrupt"] },
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        // manifest NSF contains the cell — skip-list is current.
        getManifestNsf: () => ["gen-ui-interrupt"],
      });

      const drift = findings.filter((f) => f.kind === "stale-skip-list-entry");
      expect(drift).toHaveLength(0);
    });

    it("GREEN: no getManifestNsf supplied → DRIFT guard is skipped (backward-compat)", () => {
      // Callers that do not supply getManifestNsf must not get stale-skip-list-entry.
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const findings = runMappingGuard({
        mapping: {},
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => [],
        skipList: { [TEST_SLUG]: ["any-cell"] },
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        // getManifestNsf deliberately absent
      });

      const drift = findings.filter((f) => f.kind === "stale-skip-list-entry");
      expect(drift).toHaveLength(0);
    });

    it("RED: multiple stale skip-list cells fire one finding each", () => {
      // Two cells in skip-list, neither in manifest NSF → two findings.
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const findings = runMappingGuard({
        mapping: { [TEST_SLUG]: {} },
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => [],
        skipList: { [TEST_SLUG]: ["cell-a", "cell-b"] },
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        getManifestNsf: () => [], // neither cell is in NSF
      });

      const drift = findings.filter((f) => f.kind === "stale-skip-list-entry");
      expect(drift).toHaveLength(2);
      const cells = drift.map((f) => f.cell).sort();
      expect(cells).toEqual(["cell-a", "cell-b"]);
    });

    it("RED: partial stale — one cell still in NSF, one removed → one finding", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const findings = runMappingGuard({
        mapping: { [TEST_SLUG]: {} },
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => [],
        skipList: { [TEST_SLUG]: ["still-quarantined", "un-quarantined"] },
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        getManifestNsf: () => ["still-quarantined"], // only one remains
      });

      const drift = findings.filter((f) => f.kind === "stale-skip-list-entry");
      expect(drift).toHaveLength(1);
      expect(drift[0].cell).toBe("un-quarantined");
    });
  });

  // ── case (i): live drift RED proof — simulated stale entry via fixture ────────
  //
  // Proves that the live (c) test now reads skipList from the REAL skip-list.json
  // (not from manifest NSF). By injecting a drifted entry into the skip-list via
  // __overrideSkipListForTesting, the DRIFT guard fires. Before the R6-LB fix, the
  // live test built skipList FROM manifest NSF, so this would never fire.
  describe("(i) live drift RED proof — real skip-list.json is checked against manifest NSF", () => {
    it("RED: injecting a drifted skip-list entry fires stale-skip-list-entry against real manifest NSF", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // Simulate drift: "some-stale-cell" is in the skip-list but NOT in manifest NSF.
      // This is the R6-LB RED proof: guard must fire because the skip-list and
      // manifest NSF are now INDEPENDENT sources.
      __overrideSkipListForTesting({
        [TEST_SLUG]: ["some-stale-cell"],
      });

      const findings = runMappingGuard({
        mapping: { [TEST_SLUG]: {} },
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => [],
        // Load from the REAL skip-list (via the injected override above).
        skipList: loadSkipList(),
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        // Real manifest NSF does NOT contain "some-stale-cell".
        getManifestNsf: () => ["gen-ui-interrupt", "interrupt-headless"],
      });

      const drift = findings.filter((f) => f.kind === "stale-skip-list-entry");
      expect(drift).toHaveLength(1);
      expect(drift[0].slug).toBe(TEST_SLUG);
      expect(drift[0].cell).toBe("some-stale-cell");
    });

    it("GREEN: real skip-list.json cells all present in manifest NSF → no drift finding", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // Inject a skip-list where entries ARE in the manifest NSF.
      __overrideSkipListForTesting({
        [TEST_SLUG]: ["gen-ui-interrupt"],
      });

      const findings = runMappingGuard({
        mapping: { [TEST_SLUG]: {} },
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => [],
        skipList: loadSkipList(),
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        // NSF contains the skip-list cell → consistent, no finding.
        getManifestNsf: () => ["gen-ui-interrupt", "interrupt-headless"],
      });

      const drift = findings.filter((f) => f.kind === "stale-skip-list-entry");
      expect(drift).toHaveLength(0);
    });
  });

  // ── case (j): INVERSE-COMPLETENESS — mapped cell not in expected set ──────
  //
  // Invariant 6: every cell appearing in the mapping for a flagged slug must
  // be a member of that slug's expected set. A cell that was retired from the
  // manifest but left in spec-cell-mapping.json would be silently emitted by
  // d6-rollup as a phantom verdict. The guard fires unexpected-mapped-cell
  // to force the mapping to be updated in lockstep with the manifest.
  //
  // Skip-list interaction: skip-listed cells are EXEMPT. A skip-listed cell
  // is intentionally quarantined (absent from the normal expected set), and
  // the CONSISTENCY invariant (mapped-and-skipped) already surfaces the
  // contradiction if such a cell is also mapped. Exempting skip-listed cells
  // avoids a duplicate finding for the same underlying error.
  describe("(j) INVERSE-COMPLETENESS — mapped cell absent from expected set → guard FAILS", () => {
    it("RED: a mapped cell not in the expected set fires unexpected-mapped-cell", () => {
      // "retired-feature" was removed from the manifest but still appears in
      // the mapping. Without Invariant 6, d6-rollup would emit a verdict for
      // it silently. With the guard, it surfaces as unexpected-mapped-cell.
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
          "tests/e2e/retired.spec.ts": ["retired-feature" as D5FeatureType],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        // expected set does NOT include "retired-feature"
        getExpectedCells: () => ["agentic-chat"],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      const unexpected = findings.filter(
        (f) => f.kind === "unexpected-mapped-cell",
      );
      expect(unexpected).toHaveLength(1);
      expect(unexpected[0].slug).toBe(TEST_SLUG);
      expect(unexpected[0].cell).toBe("retired-feature");
      expect(unexpected[0].spec).toBe("tests/e2e/retired.spec.ts");
    });

    it("RED: multiple mapped cells absent from expected set fire one finding each", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/good.spec.ts": ["agentic-chat"],
          "tests/e2e/retired-a.spec.ts": ["retired-a" as D5FeatureType],
          "tests/e2e/retired-b.spec.ts": ["retired-b" as D5FeatureType],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat"],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      const unexpected = findings.filter(
        (f) => f.kind === "unexpected-mapped-cell",
      );
      expect(unexpected).toHaveLength(2);
      const cells = unexpected.map((f) => f.cell).sort();
      expect(cells).toEqual(["retired-a", "retired-b"]);
    });

    it("GREEN: all mapped cells are in the expected set → no unexpected-mapped-cell findings", () => {
      // All mapped cells are in the expected set — invariant satisfied.
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
          "tests/e2e/auth.spec.ts": ["auth"],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat", "auth"],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      const unexpected = findings.filter(
        (f) => f.kind === "unexpected-mapped-cell",
      );
      expect(unexpected).toHaveLength(0);
    });

    it("GREEN: skip-listed mapped cell is exempt from inverse-completeness (CONSISTENCY fires instead)", () => {
      // "auth" is skip-listed AND mapped — this is a CONSISTENCY violation
      // (mapped-and-skipped), NOT an INVERSE-COMPLETENESS violation. The
      // skip-listed cell is exempt from Invariant 6 to avoid duplicate findings
      // for the same contradiction. The CONSISTENCY guard already fires.
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const mapping: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
          "tests/e2e/auth.spec.ts": ["auth"],
        },
      };

      const findings = runMappingGuard({
        mapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        // "auth" is NOT in expected set — but it IS skip-listed
        getExpectedCells: () => ["agentic-chat"],
        skipList: { [TEST_SLUG]: ["auth"] },
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      // mapped-and-skipped fires (CONSISTENCY invariant)
      const contradictions = findings.filter(
        (f) => f.kind === "mapped-and-skipped",
      );
      expect(contradictions).toHaveLength(1);
      expect(contradictions[0].cell).toBe("auth");

      // unexpected-mapped-cell must NOT fire (skip-listed cells are exempt)
      const unexpected = findings.filter(
        (f) => f.kind === "unexpected-mapped-cell",
      );
      expect(unexpected).toHaveLength(0);
    });

    it("GREEN: live seeded langgraph-python mapping has no unexpected-mapped-cell findings", () => {
      // This proves the real mapping+manifest are currently reconciled.
      // A cell in the mapping must be in the manifest-derived expected set —
      // if this fires, spec-cell-mapping.json has a retired cell and must
      // be updated.
      __overrideSpecDrivenSlugsForTesting(["langgraph-python"]);

      const rawMapping = SEEDED_MAPPING as unknown as SpecCellMapping;
      const realSkipList: SkipListMap = loadSkipList();

      const findings = runMappingGuard({
        mapping: rawMapping,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => LGP_EXPECTED_CELLS,
        skipList: realSkipList,
        resolveSpecPath: liveResolveSpec,
        fileExists: existsSync,
      });

      const unexpected = findings.filter(
        (f) => f.kind === "unexpected-mapped-cell",
      );
      if (unexpected.length > 0) {
        const report = unexpected
          .map(
            (f) =>
              `  [unexpected-mapped-cell] slug=${f.slug} cell=${f.cell} spec=${f.spec}`,
          )
          .join("\n");
        throw new Error(
          `Mapping contains ${unexpected.length} cell(s) absent from the expected set ` +
            `(retired from manifest but still in spec-cell-mapping.json):\n${report}`,
        );
      }
      expect(unexpected).toHaveLength(0);
    });
  });

  // ── base+delta model: resolved-map audit + new finding kinds ──────────────

  // (new-4) auto-omit satisfies CONSISTENCY: a resolved map (auto-omit already
  // applied) presents no mapped-and-skipped cell for a quarantined stem.
  describe("(new-4) auto-omit → resolved map fires no mapped-and-skipped", () => {
    it("GREEN: resolver dropped the quarantined stem, so CONSISTENCY does not fire", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // Resolved map — gen-ui-interrupt already auto-omitted (absent), even
      // though it is in the skip-list. Only non-quarantined cells remain.
      const resolved: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
        },
      };

      const findings = runMappingGuard({
        mapping: resolved,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat"],
        skipList: { [TEST_SLUG]: ["gen-ui-interrupt"] }, // quarantined but NOT in resolved
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      expect(
        findings.filter((f) => f.kind === "mapped-and-skipped"),
      ).toHaveLength(0);
    });
  });

  // (new-4b) resolver bug backstop: a resolved map that STILL contains a
  // skip-listed cell → mapped-and-skipped RED (CONSISTENCY retained).
  describe("(new-4b) resolver bug leaves mapped-and-skipped → RED backstop", () => {
    it("RED: a resolved map that still contains a skip-listed cell fires mapped-and-skipped", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      // Buggy resolved map: gen-ui-interrupt survived despite being skip-listed.
      const resolved: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/gen-ui-interrupt.spec.ts": ["gen-ui-interrupt"],
        },
      };

      const findings = runMappingGuard({
        mapping: resolved,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => [],
        skipList: { [TEST_SLUG]: ["gen-ui-interrupt"] },
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      const consistency = findings.filter(
        (f) => f.kind === "mapped-and-skipped",
      );
      expect(consistency).toHaveLength(1);
      expect(consistency[0].cell).toBe("gen-ui-interrupt");
    });
  });

  // (new-5) omit is derived → no orphan-omit kind can fire from a declared omit.
  describe("(new-5) omit is derived — no declared omit, DRIFT is the coherence check", () => {
    it("no 'orphan-omit' kind exists in the finding union (omit is auto-derived)", () => {
      // There is no declared omit in the normal path, so an orphan-omit finding
      // is structurally impossible. DRIFT (stale-skip-list-entry) remains the
      // coherence check. This is a documentation-as-assertion fixture: assert
      // no finding of an 'orphan-omit' kind is ever produced.
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const findings = runMappingGuard({
        mapping: { [TEST_SLUG]: { "tests/e2e/a.spec.ts": ["agentic-chat"] } },
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat"],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
      });

      expect(
        findings.filter((f) => (f.kind as string) === "orphan-omit"),
      ).toHaveLength(0);
    });
  });

  // (new-6) unmapped on-disk spec → advisory WARN, does NOT fail the gate.
  describe("(new-6) unmapped-onDisk-spec → advisory WARN", () => {
    it("RED-for-detection: exactly one unmapped-onDisk-spec finding, advisory (no other findings)", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const resolved: SpecCellMapping = {
        [TEST_SLUG]: {
          "tests/e2e/agentic-chat.spec.ts": ["agentic-chat"],
        },
      };

      const findings = runMappingGuard({
        mapping: resolved,
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat"],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        // agentic-chat-reasoning ran but maps to no cell → coverage hole.
        getUnmappedOnDiskSpecs: () => [
          "tests/e2e/agentic-chat-reasoning.spec.ts",
        ],
      });

      const holes = findings.filter((f) => f.kind === "unmapped-onDisk-spec");
      expect(holes).toHaveLength(1);
      expect(holes[0].slug).toBe(TEST_SLUG);
      expect(holes[0].spec).toBe("tests/e2e/agentic-chat-reasoning.spec.ts");
      // Advisory: no OTHER (gate-failing) findings caused by the hole.
      expect(
        findings.filter((f) => f.kind !== "unmapped-onDisk-spec"),
      ).toHaveLength(0);
    });

    it("GREEN: no unmapped specs → no unmapped-onDisk-spec finding", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const findings = runMappingGuard({
        mapping: { [TEST_SLUG]: { "tests/e2e/a.spec.ts": ["agentic-chat"] } },
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => ["agentic-chat"],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        getUnmappedOnDiskSpecs: () => [],
      });

      expect(
        findings.filter((f) => f.kind === "unmapped-onDisk-spec"),
      ).toHaveLength(0);
    });
  });

  // (new-collision) delta override without `force` contradicting base → RED.
  describe("(new-collision) delta-collision — override w/o force contradicts base", () => {
    it("RED: override (no force) re-maps a base-mapped stem to a DIFFERENT cell", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const delta: SlugDelta = {
        overrides: {
          // base["agentic-chat"] === ["agentic-chat"], override says ["auth"] w/o force.
          "agentic-chat": { cells: ["auth"] },
        },
      };

      const findings = runMappingGuard({
        mapping: { [TEST_SLUG]: {} },
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => [],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        getDelta: () => delta,
        getBaseCell: (stem) =>
          stem === "agentic-chat" ? ["agentic-chat"] : undefined,
      });

      const collisions = findings.filter((f) => f.kind === "delta-collision");
      expect(collisions).toHaveLength(1);
      expect(collisions[0].cell).toBe("auth");
    });

    it("GREEN: override with force → no collision (deliberate re-map)", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const delta: SlugDelta = {
        overrides: { "agentic-chat": { cells: ["auth"], force: true } },
      };

      const findings = runMappingGuard({
        mapping: { [TEST_SLUG]: {} },
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => [],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        getDelta: () => delta,
        getBaseCell: (stem) =>
          stem === "agentic-chat" ? ["agentic-chat"] : undefined,
      });

      expect(
        findings.filter((f) => f.kind === "delta-collision"),
      ).toHaveLength(0);
    });

    it("GREEN: override for a stem with no base cell → supplies missing cell, no collision", () => {
      const TEST_SLUG = "test-fixture-slug";
      __overrideSpecDrivenSlugsForTesting([TEST_SLUG]);

      const delta: SlugDelta = {
        overrides: {
          "shared-state-write": { cells: ["shared-state-write"] },
        },
      };

      const findings = runMappingGuard({
        mapping: { [TEST_SLUG]: {} },
        flaggedSlugs: __getSpecDrivenSlugsForTesting(),
        getExpectedCells: () => [],
        skipList: {},
        resolveSpecPath: () => "/fake",
        fileExists: () => true,
        getDelta: () => delta,
        getBaseCell: () => undefined, // no base cell for shared-state-write
      });

      expect(
        findings.filter((f) => f.kind === "delta-collision"),
      ).toHaveLength(0);
    });
  });
});
