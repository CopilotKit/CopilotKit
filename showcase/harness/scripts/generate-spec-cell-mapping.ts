/**
 * generate-spec-cell-mapping.ts — materialize the shared base spec→cell mapping.
 *
 * `base.json` is the entire `REGISTRY_TO_D5` map serialized keyed by stem:
 *   { "<stem>": ["<cell>", ...] }
 * for EVERY registry entry (43 keys), independent of any slug's on-disk spec set.
 *
 * The resolver (`loadSpecCellMapping(slug)`) later intersects this base with a
 * slug's on-disk specs + delta + auto-derived skip omit at resolve time. This
 * generator's only job is to keep the committed `base.json` a faithful,
 * deterministic serialization of `REGISTRY_TO_D5`.
 *
 * Usage:
 *   tsx scripts/generate-spec-cell-mapping.ts          # (re)writes base.json
 *   tsx scripts/generate-spec-cell-mapping.ts --check  # exit 1 if base.json is stale
 *
 * The `--check` mode diffs the committed base.json against REGISTRY_TO_D5
 * serialized ONLY (no filesystem scan of integrations) — so it is non-circular.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REGISTRY_TO_D5 } from "../src/probes/helpers/d5-feature-mapping.js";

const BASE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/probes/helpers/spec-cell-mapping.base.json",
);

/**
 * Deterministic stem->cells serialization of the registry map.
 * Keys are sorted; cell arrays are preserved in registry order; a trailing
 * newline is appended so the file is POSIX-clean and diffs stably.
 */
export function serializeBase(
  map: Record<string, readonly string[]>,
): string {
  const sorted: Record<string, string[]> = {};
  for (const stem of Object.keys(map).sort()) sorted[stem] = [...map[stem]];
  return JSON.stringify(sorted, null, 2) + "\n";
}

/**
 * Core freshness check: compare the file at `basePath` against the canonical
 * serialization of `REGISTRY_TO_D5`.  Returns `true` when fresh, `false` when
 * stale.  Exported so tests can exercise the check seam with a temp file path
 * instead of the committed base.json — keeps the test self-contained without
 * modifying committed fixtures.
 */
export function checkFreshness(basePath: string): boolean {
  const expected = serializeBase(REGISTRY_TO_D5);
  const actual = readFileSync(basePath, "utf-8");
  return actual === expected;
}

function main(): void {
  const check = process.argv.includes("--check");
  if (check) {
    if (!checkFreshness(BASE_PATH)) {
      console.error(
        "stale-base-mapping: spec-cell-mapping.base.json != REGISTRY_TO_D5 serialized. " +
          "Run generate-spec-cell-mapping.ts to regenerate.",
      );
      process.exit(1);
    }
    console.log("base.json fresh");
    return;
  }
  const expected = serializeBase(REGISTRY_TO_D5);
  writeFileSync(BASE_PATH, expected);
  console.log(`wrote ${BASE_PATH}`);
}

// Only run when invoked directly (not when imported by the freshness test).
const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (process.argv[1] && invokedPath === process.argv[1]) {
  main();
}
