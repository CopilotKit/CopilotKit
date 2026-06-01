/**
 * Per-integration skip-list loader.
 *
 * The skip-list declares, per integration slug, which gold spec FILES
 * are genuinely "not applicable" to that integration (a framework gap a
 * reviewer has signed off on). This makes "skipped" a DISTINCT cell
 * state — never a silent absence, never a forced red.
 *
 * Shape: `{ "<slug>": ["<spec-file>.spec.ts", …] }`.
 *
 * The DRIVER (a later cutover task) — not the rollup — calls
 * `declaredSkips(slug)` and injects the result into the pure
 * `rollupCells({ slug, specResults, skipped })`. The rollup never
 * imports this loader. Keeping the loader out of the rollup keeps the
 * rollup pure/testable and keeps skip ownership at the orchestration
 * layer.
 *
 * Validation is strict and fails LOUD at load: every value must be an
 * array of `.spec.ts` filenames. A malformed manifest is an operator
 * error that must surface immediately, not silently degrade to
 * "nothing skipped".
 *
 * The JSON is read via `fs`/`JSON.parse` (matching `spec-cell-mapping`
 * and the sibling `d5-mapping-drift` readers) rather than an
 * import-attribute, to sidestep ESM/bundler JSON-import friction.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SkipList {
  isSkipped(slug: string, specFile: string): boolean;
  declaredSkips(slug: string): string[];
}

/**
 * Build a validated `SkipList` from an in-memory source. Exported so
 * tests can inject a source without touching the checked-in JSON.
 */
export function loadSkipList(source: Record<string, string[]>): SkipList {
  const table: Record<string, ReadonlySet<string>> = {};

  for (const [slug, files] of Object.entries(source)) {
    if (!Array.isArray(files)) {
      throw new Error(
        `skip-list: entry for "${slug}" must be an array of .spec.ts filenames, got ${typeof files}`,
      );
    }
    for (const file of files) {
      if (typeof file !== "string" || !file.endsWith(".spec.ts")) {
        throw new Error(
          `skip-list: "${slug}" → ${JSON.stringify(
            file,
          )} is not a .spec.ts filename`,
        );
      }
    }
    table[slug] = new Set(files);
  }

  return {
    isSkipped(slug: string, specFile: string): boolean {
      return table[slug]?.has(specFile) ?? false;
    },
    declaredSkips(slug: string): string[] {
      const set = table[slug];
      return set ? [...set].sort() : [];
    },
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKIP_LIST_PATH = path.resolve(HERE, "skip-list.json");

const RAW = JSON.parse(
  fs.readFileSync(SKIP_LIST_PATH, "utf8"),
) as Record<string, string[]>;

const DEFAULT_SKIP_LIST = loadSkipList(RAW);

export function isSkipped(slug: string, specFile: string): boolean {
  return DEFAULT_SKIP_LIST.isSkipped(slug, specFile);
}

export function declaredSkips(slug: string): string[] {
  return DEFAULT_SKIP_LIST.declaredSkips(slug);
}
