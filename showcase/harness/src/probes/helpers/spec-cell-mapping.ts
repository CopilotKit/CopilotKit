/**
 * spec-cell-mapping — N:M spec-path → D5FeatureType mapping schema.
 *
 * Schema:
 *   {
 *     "<slug>": {
 *       "<spec-path>": ["<D5FeatureType>", ...]
 *     }
 *   }
 *
 * Cardinality is general N:M (Decision A, impl plan §1):
 *   - 1:1  — most specs, e.g. agentic-chat.spec.ts → ["agentic-chat"]
 *   - 1:many — one spec maps to multiple cells, e.g. beautiful-chat.spec.ts
 *              → 5 cells (the probe family runs five per-pill D5 scripts
 *              against /demos/beautiful-chat; see d5-feature-mapping.ts:151-157)
 *   - N:1  — multiple specs map to one cell, e.g. reasoning-custom.spec.ts
 *              and reasoning-default.spec.ts both map to ["reasoning-display"]
 *              (the D5 script covers both via preNavigateRoute)
 *   - N:M  — combination of both (e.g. declarative-hashbrown + declarative-json-render
 *              each map to ["byoc"])
 *
 * The rollup (d6-rollup.ts, Task 3.2) builds the inverse index
 * (cell → set of specs) internally. A cell is GREEN only if every spec
 * in its inverse set is PASS.
 *
 * Spec paths are relative to the integration root (e.g.
 * "tests/e2e/agentic-chat.spec.ts"), matching Playwright's per-file
 * report grouping.
 *
 * ## Hand-reconciliation notes (langgraph-python seed)
 *
 * Mapping was derived by running each spec filename stem through
 * `REGISTRY_TO_D5` in `d5-feature-mapping.ts`. Non-trivial cases:
 *
 * - `beautiful-chat.spec.ts` → 5 cells (1:many). REGISTRY_TO_D5["beautiful-chat"]
 *   maps to all five beautiful-chat-* literals per d5-feature-mapping.ts:151-157.
 *   The per-pill probe family runs five separate D5 scripts against
 *   /demos/beautiful-chat; each literal gets its own dashboard row.
 *
 * - `declarative-hashbrown.spec.ts` + `declarative-json-render.spec.ts` → ["byoc"] (N:1).
 *   Both stems map to ["byoc"] via REGISTRY_TO_D5. Two specs certify one cell;
 *   rollup requires BOTH to PASS for the byoc cell to be GREEN.
 *
 * - `reasoning-custom.spec.ts` + `reasoning-default.spec.ts` → ["reasoning-display"] (N:1).
 *   Both stems map to ["reasoning-display"]. Two specs, one cell; same rollup rule.
 *
 * - `threadid-frontend-tool-roundtrip.spec.ts` — UNMAPPED (intentional).
 *   This spec (kind="testing" in feature-registry.json) is a regression smoke
 *   for ENT-658; it has no entry in REGISTRY_TO_D5 and no corresponding
 *   D5FeatureType literal. It does not contribute to any cell verdict.
 *   Track for future addition if a "thread-id" D5FeatureType is introduced.
 */

import { basename } from "node:path";

import type { D5FeatureType } from "./d5-registry.js";
import { createLogger } from "../../logger.js";
import { loadSkipList, mergeSkipList } from "./skip-list.js";

const log = createLogger({ component: "spec-cell-mapping" });

/**
 * Mapping type:  slug → spec-path → cell list.
 *
 * `D5FeatureType[]` cells are stored as plain strings in the JSON;
 * the loader validates shape but does not check that each string is a
 * valid `D5FeatureType` — that is the job of the CI guard (Task 2.2,
 * spec-cell-mapping.test.ts completeness/uniqueness checks). Keeping
 * the loader validation shape-only means it stays fast and stateless
 * (no import of the D5_FEATURE_TYPES runtime array).
 */
export type SpecCellMapping = Record<string, Record<string, D5FeatureType[]>>;

/** Keys that must never appear as slug or spec-path keys — prototype pollution vectors. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parse and validate a raw JSON string into a `SpecCellMapping`.
 *
 * Validation rules:
 *   1. Must be valid JSON (throws SyntaxError on parse failure).
 *   2. Top level must be a plain object (not array, null, or primitive).
 *   3. Each slug key must not be a dangerous prototype key (__proto__, constructor, prototype).
 *   4. Each slug value must be a plain object.
 *   5. Each spec-path key must not be a dangerous prototype key.
 *   6. Each spec-path value must be an array of strings.
 *   7. Cell name strings must be non-empty.
 *   8. Cell names within a spec path must be unique (no intra-spec duplicates).
 *
 * Does NOT validate that cell strings are known `D5FeatureType` literals
 * (that is the CI guard's job so consumers can load unmigrated slugs
 * without crashing the guard-free loader path).
 *
 * @throws {SyntaxError}  on invalid JSON.
 * @throws {TypeError}    on shape violations (message includes "SpecCellMapping").
 */
export function parseSpecCellMapping(json: string): SpecCellMapping {
  // Step 1: parse — throws SyntaxError on bad JSON (native, intentional).
  const parsed: unknown = JSON.parse(json);

  // Step 2: top-level must be a plain object.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(
      `SpecCellMapping: top-level value must be a plain object, got ${
        Array.isArray(parsed)
          ? "array"
          : parsed === null
            ? "null"
            : typeof parsed
      }`,
    );
  }

  const top = parsed as Record<string, unknown>;

  for (const [slug, specMap] of Object.entries(top)) {
    // Step 3: reject dangerous prototype keys at the slug level.
    if (DANGEROUS_KEYS.has(slug)) {
      throw new TypeError(
        `SpecCellMapping: dangerous key "${slug}" is not allowed as a slug key`,
      );
    }

    // Step 4: each slug value must be a plain object.
    if (
      typeof specMap !== "object" ||
      specMap === null ||
      Array.isArray(specMap)
    ) {
      throw new TypeError(
        `SpecCellMapping: value for slug "${slug}" must be a plain object, got ${
          Array.isArray(specMap)
            ? "array"
            : specMap === null
              ? "null"
              : typeof specMap
        }`,
      );
    }

    const specObj = specMap as Record<string, unknown>;

    for (const [specPath, cells] of Object.entries(specObj)) {
      // Step 5: reject dangerous prototype keys at the spec-path level.
      if (DANGEROUS_KEYS.has(specPath)) {
        throw new TypeError(
          `SpecCellMapping: dangerous key "${specPath}" is not allowed as a spec-path key in slug "${slug}"`,
        );
      }

      // Step 6: each cell list must be an array of strings.
      if (!Array.isArray(cells)) {
        throw new TypeError(
          `SpecCellMapping: cell list for slug "${slug}" / spec "${specPath}" must be an array, got ${typeof cells}`,
        );
      }

      const seen = new Set<string>();
      for (const cell of cells) {
        if (typeof cell !== "string") {
          throw new TypeError(
            `SpecCellMapping: cell entry for slug "${slug}" / spec "${specPath}" must be a string, got ${typeof cell}`,
          );
        }
        // Step 7: cell name must be non-empty.
        if (cell === "") {
          throw new TypeError(
            `SpecCellMapping: empty cell name is not allowed for slug "${slug}" / spec "${specPath}"`,
          );
        }
        // Step 8: no intra-spec duplicate cells.
        if (seen.has(cell)) {
          throw new TypeError(
            `SpecCellMapping: duplicate cell "${cell}" in slug "${slug}" / spec "${specPath}"`,
          );
        }
        seen.add(cell);
      }
    }
  }

  // Shape validated — cast is safe.
  return top as SpecCellMapping;
}

/**
 * Load the default `spec-cell-mapping.json` bundled with the harness.
 *
 * Callers that need to load a custom path should use `parseSpecCellMapping`
 * directly with `fs.readFileSync(path, "utf-8")`.
 */

let _mappingOverride: SpecCellMapping | undefined;

export async function loadDefaultSpecCellMapping(): Promise<SpecCellMapping> {
  if (_mappingOverride !== undefined) return _mappingOverride;
  // Dynamic import keeps the JSON out of the top-level module graph —
  // the mapping may grow large and callers that never need it should not
  // pay the parse cost.
  const mod = await import("./spec-cell-mapping.json", {
    with: { type: "json" },
  });
  return parseSpecCellMapping(JSON.stringify(mod.default));
}

/**
 * Override the default mapping for testing. Pass `undefined` to restore
 * the bundled JSON. The override value is validated through the same
 * `parseSpecCellMapping` validator as the real JSON load path — callers
 * cannot bypass validation by supplying a raw untested object.
 *
 * @internal Testing only.
 */
export function __overrideSpecCellMappingForTesting(
  override: SpecCellMapping | undefined,
): void {
  if (override === undefined) {
    _mappingOverride = undefined;
    return;
  }
  // Validate the override through the real load path (round-trip through JSON
  // so the validator sees the same shape as a real JSON load would).
  _mappingOverride = parseSpecCellMapping(JSON.stringify(override));
}

// ── base+delta resolver: loadSpecCellMapping(slug, deps) ─────────────────────
//
// The resolver replaces the single-slug JSON lookup. For a slug it computes the
// resolved per-spec mapping  base ⊕ override(slug) ⊖ auto-omit(slug)  restricted
// to the spec files actually present in that slug's tests/e2e/ dir:
//
//   - base[stem]                — the shared authority (generated from
//                                 REGISTRY_TO_D5, keyed by spec-filename stem).
//   - delta.overrides[stem]     — a per-slug cell for a stem the base can't map
//                                 (no base cell), or a `force`d re-map.
//   - auto-derived omit         — any on-disk mapped stem whose cell set is
//                                 fully in the merged skip-list is dropped
//                                 (the gen-ui-interrupt class); never hand-authored.
//   - explicit delta.omit       — rare escape hatch for partial-quarantine.
//
// Because base covers the shared surface, the resolved mapping is non-empty for
// EVERY slug that has ≥1 present, mapped, non-quarantined spec → the
// empty-verdicts / F3 mass-red path is unreachable for them.

/**
 * Parse and validate a raw JSON string into a `SpecCellDelta`.
 *
 * Validation rules (symmetric to `parseSpecCellMapping`):
 *   1. Must be valid JSON (throws SyntaxError on parse failure).
 *   2. Top level must be a plain object.
 *   3. Each slug key must not be a dangerous prototype key.
 *   4. Each slug value must be a plain object.
 *   5. `overrides`, if present, must be a plain object (not array/null).
 *   6. Each override stem key must not be a dangerous prototype key.
 *   7. Each override entry must be a plain object.
 *   8. `cells` in each override entry must be an array of strings.
 *   9. `omit`, if present, must be an array of strings.
 *
 * @throws {SyntaxError}  on invalid JSON.
 * @throws {TypeError}    on shape violations (message includes "SpecCellDelta").
 */
export function parseSpecCellDelta(json: string): SpecCellDelta {
  // Step 1: parse.
  const parsed: unknown = JSON.parse(json);

  // Step 2: top-level must be a plain object.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(
      `SpecCellDelta: top-level value must be a plain object, got ${
        Array.isArray(parsed)
          ? "array"
          : parsed === null
            ? "null"
            : typeof parsed
      }`,
    );
  }

  const top = parsed as Record<string, unknown>;

  for (const [slug, slugVal] of Object.entries(top)) {
    // Step 3: reject dangerous keys at slug level.
    if (DANGEROUS_KEYS.has(slug)) {
      throw new TypeError(
        `SpecCellDelta: dangerous key "${slug}" is not allowed as a slug key`,
      );
    }

    // Step 4: each slug value must be a plain object.
    if (
      typeof slugVal !== "object" ||
      slugVal === null ||
      Array.isArray(slugVal)
    ) {
      throw new TypeError(
        `SpecCellDelta: value for slug "${slug}" must be a plain object, got ${
          Array.isArray(slugVal)
            ? "array"
            : slugVal === null
              ? "null"
              : typeof slugVal
        }`,
      );
    }

    const slugObj = slugVal as Record<string, unknown>;

    // Step 5: validate overrides if present.
    if ("overrides" in slugObj) {
      const overrides = slugObj["overrides"];
      if (
        typeof overrides !== "object" ||
        overrides === null ||
        Array.isArray(overrides)
      ) {
        throw new TypeError(
          `SpecCellDelta: "overrides" for slug "${slug}" must be a plain object, got ${
            Array.isArray(overrides)
              ? "array"
              : overrides === null
                ? "null"
                : typeof overrides
          }`,
        );
      }

      const overridesObj = overrides as Record<string, unknown>;

      for (const [stem, entry] of Object.entries(overridesObj)) {
        // Step 6: reject dangerous stem keys.
        if (DANGEROUS_KEYS.has(stem)) {
          throw new TypeError(
            `SpecCellDelta: dangerous key "${stem}" is not allowed as an override stem key in slug "${slug}"`,
          );
        }

        // Step 7: each override entry must be a plain object.
        if (
          typeof entry !== "object" ||
          entry === null ||
          Array.isArray(entry)
        ) {
          throw new TypeError(
            `SpecCellDelta: override entry for stem "${stem}" in slug "${slug}" must be a plain object, got ${
              Array.isArray(entry)
                ? "array"
                : entry === null
                  ? "null"
                  : typeof entry
            }`,
          );
        }

        const entryObj = entry as Record<string, unknown>;

        // Step 8: cells must be an array of strings.
        if (!Array.isArray(entryObj["cells"])) {
          throw new TypeError(
            `SpecCellDelta: "cells" for stem "${stem}" in slug "${slug}" must be an array, got ${typeof entryObj["cells"]}`,
          );
        }
        for (const cell of entryObj["cells"] as unknown[]) {
          if (typeof cell !== "string") {
            throw new TypeError(
              `SpecCellDelta: cell entry for stem "${stem}" in slug "${slug}" must be a string, got ${typeof cell}`,
            );
          }
        }
      }
    }

    // Step 9: validate omit if present.
    if ("omit" in slugObj) {
      const omit = slugObj["omit"];
      if (!Array.isArray(omit)) {
        throw new TypeError(
          `SpecCellDelta: "omit" for slug "${slug}" must be an array, got ${typeof omit}`,
        );
      }
      for (const item of omit as unknown[]) {
        if (typeof item !== "string") {
          throw new TypeError(
            `SpecCellDelta: "omit" entry for slug "${slug}" must be a string, got ${typeof item}`,
          );
        }
      }
    }
  }

  return top as SpecCellDelta;
}

/** Per-slug departures from the shared base. */
export interface SlugDelta {
  /**
   * stem -> cell override. Permitted when the stem has no base cell
   * (supplies a missing cell) or is `force`d (re-maps a base-mapped stem to a
   * different cell). Without `force`, an override whose stem already has a
   * DIFFERENT base cell is a delta-collision (caught by the guard).
   */
  overrides?: Record<string, { cells: D5FeatureType[]; force?: boolean }>;
  /**
   * Rare explicit partial-quarantine escape hatch: stems to drop even when the
   * auto-derived skip-list omit would NOT remove them (only some of a
   * multi-cell stem's cells are skipped).
   */
  omit?: string[];
}

/** Delta map:  slug -> SlugDelta. */
export type SpecCellDelta = Record<string, SlugDelta>;

/** Dependencies injected into the resolver so it is unit-testable without disk. */
export interface ResolveDeps {
  /** stem -> cells (from base.json). */
  base: Record<string, D5FeatureType[]>;
  /** slug -> delta (from spec-cell-delta.json). */
  delta: SpecCellDelta;
  /** On-disk "tests/e2e/*.spec.ts" relpaths for the slug. */
  listPresentSpecs: (slug: string) => string[];
  /** loadSkipList ∪ manifest NSF, per slug (the merged skip-list). */
  mergedSkipList: (slug: string) => Set<string>;
  /** WARN sink for on-disk specs whose stem has no cell (default: log.warn). */
  onUnmapped?: (slug: string, specRelPath: string) => void;
  /** WARN sink for stems dropped because all cells are in the merged skip-list (default: log.warn). */
  onAutoOmit?: (slug: string, stem: string) => void;
}

function defaultWarn(slug: string, specRelPath: string): void {
  log.warn("spec-cell-mapping.unmapped-onDisk-spec", {
    slug,
    spec: specRelPath,
    note: "on-disk spec stem has no base cell and no override — coverage hole (spec runs, feeds no cell)",
  });
}

function defaultAutoOmitWarn(slug: string, stem: string): void {
  log.warn("spec-cell-mapping.auto-omit", {
    slug,
    stem,
    note: "all cells for this stem are in the merged skip-list (NSF-quarantined) — stem dropped from resolved mapping",
  });
}

/**
 * Resolve a slug's spec→cell mapping from base + delta + auto-derived omit,
 * restricted to on-disk specs. Pure over its injected `deps` (no I/O).
 *
 * @param slug  Integration slug (e.g. "langgraph-python").
 * @param deps  Injected base map, delta map, present-spec lister, merged
 *              skip-list, and optional WARN sink.
 * @returns     spec-relpath -> cells, non-empty whenever the slug has ≥1
 *              present, mapped, non-quarantined spec.
 */
export function loadSpecCellMapping(
  slug: string,
  deps: ResolveDeps,
): Record<string, D5FeatureType[]> {
  const skipped = deps.mergedSkipList(slug);
  const delta = deps.delta[slug] ?? {};
  const explicitOmit = new Set(delta.omit ?? []);
  const out: Record<string, D5FeatureType[]> = {};
  for (const rel of deps.listPresentSpecs(slug)) {
    const stem = basename(rel).replace(/\.spec\.ts$/, "");
    if (explicitOmit.has(stem)) continue;
    const override = delta.overrides?.[stem];
    const cells: D5FeatureType[] | undefined =
      override && (override.force || !deps.base[stem])
        ? override.cells
        : deps.base[stem];
    if (!cells || cells.length === 0) {
      (deps.onUnmapped ?? defaultWarn)(slug, rel);
      continue;
    }
    // AUTO-DERIVED omit: drop any stem whose cell set is fully skip/NSF-quarantined.
    if (cells.every((c) => skipped.has(c))) {
      (deps.onAutoOmit ?? defaultAutoOmitWarn)(slug, stem);
      continue;
    }
    out[rel] = [...cells];
  }
  return out;
}

// ── default loaders (wire base.json, spec-cell-delta.json, skip-list) ────────

let _deltaOverride: SpecCellDelta | undefined;

/**
 * Load the committed `spec-cell-delta.json` (slug -> SlugDelta). Dynamic import
 * mirrors the base loader so the JSON stays out of the top-level module graph.
 */
export async function loadDelta(): Promise<SpecCellDelta> {
  if (_deltaOverride !== undefined) return _deltaOverride;
  const mod = await import("./spec-cell-delta.json", {
    with: { type: "json" },
  });
  return parseSpecCellDelta(JSON.stringify(mod.default));
}

/**
 * Override the delta map for testing. Pass `undefined` to restore the JSON.
 * @internal Testing only.
 */
export function __overrideSpecCellDeltaForTesting(
  override: SpecCellDelta | undefined,
): void {
  _deltaOverride = override;
}

/**
 * Convenience wrapper that wires the resolver against the committed
 * `base.json`, `spec-cell-delta.json`, and the merged skip-list
 * (`loadSkipList()` ∪ manifest NSF). Callers supply a present-spec lister
 * (rooted at the slug's integration dir) and the slug's manifest
 * `not_supported_features`.
 */
export async function loadDefaultResolvedMapping(
  slug: string,
  opts: {
    listPresentSpecs: (slug: string) => string[];
    notSupportedFeatures?: string[];
    onUnmapped?: (slug: string, specRelPath: string) => void;
  },
): Promise<Record<string, D5FeatureType[]>> {
  const baseMod = await import("./spec-cell-mapping.base.json", {
    with: { type: "json" },
  });
  const base = baseMod.default as Record<string, D5FeatureType[]>;
  const delta = await loadDelta();
  let skipList = loadSkipList();
  if (opts.notSupportedFeatures && opts.notSupportedFeatures.length > 0) {
    skipList = mergeSkipList(skipList, slug, opts.notSupportedFeatures);
  }
  return loadSpecCellMapping(slug, {
    base,
    delta,
    listPresentSpecs: opts.listPresentSpecs,
    mergedSkipList: (s) => new Set<string>(skipList[s] ?? []),
    onUnmapped: opts.onUnmapped,
  });
}
