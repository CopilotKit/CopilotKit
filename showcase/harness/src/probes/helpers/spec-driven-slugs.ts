/**
 * Spec-driven slug flag loader.
 *
 * Reads `spec-driven-slugs.json` to determine which integration slugs use
 * spec-driven verdict sources instead of the heuristic conversation runner.
 *
 * SAFE DEFAULT: the JSON file ships EMPTY (`{ "spec_driven_slugs": [] }`),
 * so every slug resolves to false (heuristic remains authoritative) until a
 * slug is explicitly added in a reviewed PR.
 *
 * The `isSpecDriven(slug)` predicate is the single call-site for the flag
 * check — both the D6 driver (Task 5.1) and `cli/e2e.ts` (Task 4.1) import
 * it. The driver reads the flag file itself (per `inputSchema`, which has no
 * `spec_driven` field).
 *
 * Test helpers (`__*ForTesting`) allow unit tests to inject an override list
 * without touching the filesystem, keeping tests hermetic.
 */

import rawJson from "./spec-driven-slugs.json" with { type: "json" };

// ── type + validation ───────────────────────────────────────────────────────

interface SpecDrivenSlugsJson {
  spec_driven_slugs: string[];
}

/**
 * Validate the shape of spec-driven-slugs.json.
 *
 * Exported for test coverage (tests call the real validator, not a duplicate).
 * Reads `spec_driven_slugs` via own-key access only to prevent prototype-chain
 * inherited keys from masking a truly missing field.
 */
export function validateSpecDrivenSlugsShape(
  raw: unknown,
): SpecDrivenSlugsJson {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("spec-driven-slugs.json must be a plain object");
  }
  const obj = raw as Record<string, unknown>;
  // Own-key check only — an inherited `spec_driven_slugs` must not satisfy
  // the presence guard (prototype-pollution safety).
  if (
    !Object.prototype.hasOwnProperty.call(obj, "spec_driven_slugs") ||
    !Array.isArray(obj["spec_driven_slugs"])
  ) {
    throw new Error(
      'spec-driven-slugs.json must have a "spec_driven_slugs" array',
    );
  }
  for (const entry of obj["spec_driven_slugs"] as unknown[]) {
    if (typeof entry !== "string") {
      throw new Error(
        `spec-driven-slugs.json: every entry must be a string, got ${typeof entry}`,
      );
    }
  }
  return obj as unknown as SpecDrivenSlugsJson;
}

// ── module-level state ──────────────────────────────────────────────────────

const _fromFile: string[] =
  validateSpecDrivenSlugsShape(rawJson).spec_driven_slugs;

// Override slot for unit tests; undefined means "use the file-loaded list".
let _override: string[] | undefined = undefined;

function _current(): string[] {
  return _override !== undefined ? _override : _fromFile;
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Returns true iff `slug` is listed in the `spec_driven_slugs` array.
 *
 * With the Phase-0 empty JSON this always returns false, keeping the
 * heuristic authoritative for all slugs.
 */
export function isSpecDriven(slug: string): boolean {
  return _current().includes(slug);
}

// ── test helpers (export for test files only) ───────────────────────────────

/**
 * Override the active slug list for test isolation.
 * Pass `undefined` to restore the file-loaded default.
 *
 * @internal Use only in `.test.ts` files.
 */
export function __overrideSpecDrivenSlugsForTesting(
  slugs: string[] | undefined,
): void {
  _override = slugs;
}

/**
 * Expose the active slug list for assertions.
 *
 * @internal Use only in `.test.ts` files.
 */
export function __getSpecDrivenSlugsForTesting(): string[] {
  return _current();
}
