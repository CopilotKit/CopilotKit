/**
 * Drift test — `STARTER_TO_COLUMN` vs the smoke matrix and the dashboard
 * columns.
 *
 * The harness `starter_smoke` probe family remaps each starter slug to a
 * dashboard COLUMN slug via `STARTER_TO_COLUMN` before emitting
 * `starter:<column-slug>/<level>` rows. Two ways that mapping silently rots:
 *
 *   1. A starter is added/renamed in the smoke matrix
 *      (`STARTERS` in `showcase/tests/e2e/starter-smoke.spec.ts`) but the
 *      remap is not updated ⇒ the new starter is probed but its rows are
 *      dropped (no column to write to) — the bug the spec's §a lint guards.
 *   2. A column slug in the remap no longer matches a real
 *      `showcase/integrations/<slug>/manifest.yaml` directory (a column was
 *      renamed/removed) ⇒ the harness writes rows the dashboard can never
 *      read; the cell stays "not yet run" forever.
 *
 * This test catches both. It mirrors `d5-mapping-drift.test.ts`: the smoke
 * matrix lives in a Playwright spec outside this pnpm workspace and the
 * column list is the on-disk integration directory set, so both are parsed
 * via `fs` rather than imported. The set of starters with NO column
 * (`EXCLUDED_STARTERS`) is empty by design (all 12 map), but is kept
 * explicit so a future no-column starter can be excluded deliberately
 * instead of silently failing coverage.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { STARTER_TO_COLUMN } from "./starter-mapping.js";

const STARTER_SPEC_FILE = resolve(
  __dirname,
  "../../../../tests/e2e/starter-smoke.spec.ts",
);

const INTEGRATIONS_DIR = resolve(__dirname, "../../../../integrations");

/**
 * Starters intentionally probed but with no dashboard column. Empty by
 * design (§a: 12 mapped, 0 excluded), but kept explicit so a deliberate
 * future exclusion is distinguishable from an accidental dropped mapping.
 */
const EXCLUDED_STARTERS: ReadonlySet<string> = new Set<string>();

/** Parse the `slug:` values out of the `STARTERS` array in the smoke spec. */
function parseSmokeMatrixSlugs(): string[] {
  const src = readFileSync(STARTER_SPEC_FILE, "utf8");
  const block = src.match(
    /const STARTERS:\s*Starter\[\]\s*=\s*\[([\s\S]+?)\n\];/,
  );
  if (!block || !block[1]) {
    throw new Error(
      "drift parser: could not locate `STARTERS` array in starter-smoke.spec.ts — " +
        "if the spec's shape changed, update the regex in this test.",
    );
  }
  const slugs = Array.from(
    block[1].matchAll(/slug:\s*"([^"]+)"/g),
    (m) => m[1] as string,
  );
  if (slugs.length === 0) {
    throw new Error(
      "drift parser: matched the STARTERS block but found no `slug:` entries.",
    );
  }
  return slugs;
}

/** The on-disk dashboard column slugs = integration manifest directories. */
function readColumnSlugs(): Set<string> {
  return new Set(
    readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name),
  );
}

describe("starter-mapping-drift", () => {
  it("every smoke-matrix starter is either mapped or explicitly excluded", () => {
    const matrixSlugs = parseSmokeMatrixSlugs();
    const unaccounted = matrixSlugs.filter(
      (slug) => !(slug in STARTER_TO_COLUMN) && !EXCLUDED_STARTERS.has(slug),
    );
    expect(
      unaccounted,
      `starters in the smoke matrix with no mapping AND no explicit exclusion: ` +
        `${JSON.stringify(unaccounted)} — add them to STARTER_TO_COLUMN ` +
        `(starter-mapping.ts) or to EXCLUDED_STARTERS in this test.`,
    ).toEqual([]);
  });

  it("every mapped column slug exists as a real dashboard column (manifest dir)", () => {
    const columns = readColumnSlugs();
    const orphans = Object.entries(STARTER_TO_COLUMN)
      .filter(([, columnSlug]) => !columns.has(columnSlug))
      .map(([starterSlug, columnSlug]) => `${starterSlug}→${columnSlug}`);
    expect(
      orphans,
      `mapped column slugs with no matching showcase/integrations/<slug> ` +
        `manifest directory: ${JSON.stringify(orphans)} — a column was ` +
        `renamed/removed, or the mapping has a typo.`,
    ).toEqual([]);
  });

  it("no mapped starter is also excluded (mutually exclusive sets)", () => {
    const both = Object.keys(STARTER_TO_COLUMN).filter((s) =>
      EXCLUDED_STARTERS.has(s),
    );
    expect(
      both,
      `starters both mapped and excluded: ${JSON.stringify(both)}`,
    ).toEqual([]);
  });
});
