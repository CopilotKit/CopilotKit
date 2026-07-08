/**
 * Skip-list loader.
 *
 * A "skip" declares that a particular (slug, cell) combination should be
 * rendered as SKIPPED rather than RED/UNKNOWN when running spec-driven
 * verdicts. Two sources compose the active skip-list:
 *
 *   1. Static JSON (`skip-list.json`) — reviewed, committed, per-slug cell
 *      arrays. Ships with quarantined cells for flagged slugs (e.g.
 *      langgraph-python: gen-ui-interrupt, interrupt-headless); entries are
 *      validated against each slug's manifest `not_supported_features` by
 *      the spec-cell-mapping CI guard (Invariant 5: DRIFT) to prevent stale
 *      entries from silently masking cells that were later un-quarantined.
 *   2. Runtime `notSupportedFeatures` from each slug's manifest input —
 *      these mirror the existing `incapableSet` logic in `d6-all-pills.ts`
 *      (line ~885) and are folded in by the caller via `mergeSkipList`.
 *
 * Shape of `skip-list.json`:
 *   {
 *     "<slug>": ["<D5FeatureType>", ...]
 *   }
 *
 * `mergeSkipList` is a PURE function — it does not mutate its input.
 */

import rawJson from "./skip-list.json" with { type: "json" };

// ── types ───────────────────────────────────────────────────────────────────

/** Map of slug → list of skipped cell names (D5FeatureType strings). */
export type SkipListMap = Record<string, string[]>;

/** Keys that must never appear as slug keys — prototype pollution vectors. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// ── validation ──────────────────────────────────────────────────────────────

/**
 * Validate the shape of the skip-list JSON.
 *
 * Exported for test coverage (tests call the real validator, not a duplicate).
 * Iterates own-enumerable keys only to avoid prototype-chain pollution.
 */
export function validateSkipListShape(raw: unknown): Record<string, string[]> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("skip-list.json must be a plain object");
  }
  // Use own-enumerable keys only — prevents prototype-chain inherited keys
  // (e.g. toString) from being iterated and treated as slug entries.
  for (const slug of Object.keys(raw as Record<string, unknown>)) {
    // Reject dangerous prototype keys explicitly.
    if (DANGEROUS_KEYS.has(slug)) {
      throw new Error(
        `skip-list.json: dangerous key "${slug}" is not allowed as a slug key`,
      );
    }
    const cells = (raw as Record<string, unknown>)[slug];
    if (!Array.isArray(cells)) {
      throw new Error(
        `skip-list.json: entry for "${slug}" must be an array, got ${typeof cells}`,
      );
    }
    for (const cell of cells as unknown[]) {
      if (typeof cell !== "string") {
        throw new Error(
          `skip-list.json: cell entries under "${slug}" must be strings, got ${typeof cell}`,
        );
      }
    }
  }
  return raw as Record<string, string[]>;
}

// ── module-level state ──────────────────────────────────────────────────────

const _fromFile: Record<string, string[]> = validateSkipListShape(rawJson);

// Override slot for unit tests.
let _override: Record<string, string[]> | undefined = undefined;

function _current(): Record<string, string[]> {
  return _override !== undefined ? _override : _fromFile;
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Returns the skip-list map as loaded from `skip-list.json`
 * (or the test override, if set).
 *
 * Callers that need to fold in runtime `notSupportedFeatures` should
 * pass the result to `mergeSkipList`.
 *
 * Returns a DEEP copy — inner cell arrays are new instances — so callers
 * cannot mutate module state by appending to or splicing a returned array.
 * (A shallow `{ ...map }` copy shares inner arrays with the module cache;
 * a caller doing `result["slug"].push(x)` would corrupt the cached state.)
 */
export function loadSkipList(): Record<string, string[]> {
  const src = _current();
  const copy: Record<string, string[]> = {};
  for (const slug of Object.keys(src)) {
    copy[slug] = [...src[slug]];
  }
  return copy;
}

/**
 * Produces a new skip-list map by unioning `notSupportedFeatures` (from a
 * slug's manifest) into `base[slug]`. Does NOT mutate `base`.
 *
 * This mirrors the `incapableSet` construction in `d6-all-pills.ts` line ~885:
 *   `const incapableSet = new Set<string>(input.notSupportedFeatures ?? []);`
 * but expressed as a pure merge so both the driver and `cli/e2e.ts` share
 * the same fold-in logic.
 *
 * @param base  - Result of `loadSkipList()` (or a prior merge).
 * @param slug  - The integration slug whose manifest is being processed.
 * @param notSupportedFeatures - Array of feature strings from the manifest.
 * @returns New map with the union applied for `slug`. Always a fresh object.
 */
/**
 * Deep-copy the base map's inner arrays so the returned map is fully
 * independent of `base` — mutating any returned inner array will not
 * corrupt the caller's base. Both the empty-branch and the non-empty
 * branch must deep-copy to align with `loadSkipList`'s deep-copy contract.
 */
function deepCopyBase(
  base: Record<string, string[]>,
): Record<string, string[]> {
  const copy: Record<string, string[]> = {};
  for (const slug of Object.keys(base)) {
    copy[slug] = [...base[slug]];
  }
  return copy;
}

export function mergeSkipList(
  base: SkipListMap,
  slug: string,
  notSupportedFeatures: string[],
): SkipListMap {
  if (notSupportedFeatures.length === 0) {
    // Deep-copy all inner arrays — a shallow spread (`{ ...base }`) shares
    // inner array references with base, allowing callers to corrupt module
    // state via the returned copy.
    return deepCopyBase(base);
  }
  const copy = deepCopyBase(base);
  const existing = copy[slug] ?? [];
  copy[slug] = [...new Set([...existing, ...notSupportedFeatures])];
  return copy;
}

// ── test helpers ────────────────────────────────────────────────────────────

/**
 * Override the active skip-list for test isolation.
 * Pass `undefined` to restore the file-loaded default.
 *
 * @internal Use only in `.test.ts` files.
 */
export function __overrideSkipListForTesting(
  map: Record<string, string[]> | undefined,
): void {
  _override = map;
}
