/**
 * Spec-file → dashboard-cell mapping (single source of truth).
 *
 * D6 cells are (feature × integration). The measurement runs each
 * integration's Playwright e2e suite (the LGP gold suite, run verbatim
 * per integration) and maps each spec FILE result to exactly ONE
 * dashboard feature column. The mapping is strictly 1:1: one spec file
 * → one column, one column → one spec file. There is NO aggregate /
 * "all-files-must-pass" collapse path — features that conceptually span
 * multiple spec files (e.g. `reasoning-default` + `reasoning-custom`, or
 * the `shared-state-*` family) are each their OWN column/cell.
 *
 * The column vocabulary is the feature-registry feature ids
 * (`showcase/shared/feature-registry.json`); 37 of the 38 gold spec
 * stems match a registry id verbatim. The one exception,
 * `threadid-frontend-tool-roundtrip`, has no registry id today and is
 * mapped to its own stem as a distinct column (flagged for the Step 3b
 * one-time human reconciliation — see the mapping JSON / plan).
 *
 * The mapping JSON is read via `fs`/`JSON.parse` rather than an
 * `import ... with { type: "json" }` attribute: the harness has no
 * existing JSON-import-attribute usage, and `fs` parsing matches the
 * sibling cross-file readers (`d5-mapping-drift.test.ts`) and sidesteps
 * ESM/bundler import-attribute friction under vitest + tsc.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAPPING_PATH = path.resolve(HERE, "spec-cell-mapping.json");

const RAW = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8")) as Record<
  string,
  unknown
>;

// Mapping is strictly 1:1 (one spec file → one column); there is no
// `_aggregates` key. The `_`-prefix filter below is purely defensive
// against any future meta-key and must NOT be read as support for an
// aggregate path.
const TABLE: Record<string, string> = Object.fromEntries(
  Object.entries(RAW)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => {
      if (typeof v !== "string") {
        throw new Error(
          `spec-cell-mapping.json: column for "${k}" must be a string, got ${typeof v}`,
        );
      }
      return [k, v];
    }),
);

export function mapSpecFileToCell(specFile: string): string | null {
  return TABLE[specFile] ?? null;
}

export function allMappedSpecFiles(): string[] {
  return Object.keys(TABLE).sort();
}
