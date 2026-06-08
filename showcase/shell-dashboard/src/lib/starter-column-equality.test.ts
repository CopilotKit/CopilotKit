/**
 * Cross-package value-equality drift test — dashboard `STARTER_COLUMNS` vs the
 * harness `STARTER_TO_COLUMN` column-slug VALUES.
 *
 * The harness `starter_smoke` probe family remaps each starter slug to a
 * dashboard COLUMN slug via `STARTER_TO_COLUMN`
 * (`showcase/harness/src/probes/helpers/starter-mapping.ts`) and emits
 * `starter:<column-slug>/<level>` rows. The dashboard keeps its OWN copy of
 * that mapping's VALUE SET — `STARTER_COLUMNS` in `live-status.ts` — to decide
 * which columns render a starter cell vs the grey "not supported" ✗.
 *
 * The existing guards only check COUNTS (each side asserts 12). That lets a
 * future slug RENAME on one side (e.g. harness `strands` → `strands-x` without
 * the dashboard following) keep both counts at 12 while silently flipping a
 * column to the grey "not-supported" state — a green starter would render as if
 * it had no starter at all. This test closes that gap by asserting SET-EQUALITY
 * between the harness column-slug values and the dashboard `STARTER_COLUMNS`.
 *
 * The harness mapping lives in a SEPARATE pnpm workspace
 * (`showcase/harness`), so the dashboard cannot import across the package
 * boundary. We parse the harness source via `fs` (mirroring the harness-side
 * `starter-mapping-drift.test.ts` which `fs`-reads the Playwright spec and the
 * integrations dir), reading the authoritative `STARTER_TO_COLUMN` values
 * directly so a rename on the harness side reds this test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STARTER_COLUMNS } from "./live-status";

const HARNESS_MAPPING_FILE = resolve(
  __dirname,
  "../../../harness/src/probes/helpers/starter-mapping.ts",
);

/**
 * Parse the VALUE side of every `key: "value"` (or `key: value` direct) entry
 * in the `STARTER_TO_COLUMN` object literal of the harness source. Throws if
 * the block can't be located so a shape change is loud, not a silent pass.
 */
function parseHarnessColumnSlugs(): string[] {
  const src = readFileSync(HARNESS_MAPPING_FILE, "utf8");
  const block = src.match(/STARTER_TO_COLUMN[^=]*=\s*\{([\s\S]+?)\n\};/);
  if (!block || !block[1]) {
    throw new Error(
      "equality parser: could not locate `STARTER_TO_COLUMN` object literal in " +
        "starter-mapping.ts — if the source shape changed, update this regex.",
    );
  }
  // Match the value side of each `<key>: "<column-slug>"` entry, skipping
  // comment lines (`// ...`). Values are always double-quoted column slugs.
  const values = Array.from(
    block[1].matchAll(/^\s*(?:"[^"]+"|[\w-]+)\s*:\s*"([^"]+)"/gm),
    (m) => m[1] as string,
  );
  if (values.length === 0) {
    throw new Error(
      "equality parser: parsed zero column-slug values from STARTER_TO_COLUMN — " +
        "regex likely drifted from the source shape.",
    );
  }
  return values;
}

describe("starter column-slug cross-package equality", () => {
  it("dashboard STARTER_COLUMNS exactly equals the harness STARTER_TO_COLUMN value set", () => {
    const harnessValues = new Set(parseHarnessColumnSlugs());
    const dashboardColumns = STARTER_COLUMNS;

    // Every harness-emitted column slug must be a renderable dashboard column.
    for (const slug of harnessValues) {
      expect(
        dashboardColumns.has(slug),
        `harness emits starter:${slug}/* but the dashboard has no STARTER_COLUMNS entry for "${slug}" — it would render grey "not supported"`,
      ).toBe(true);
    }
    // Every dashboard starter column must be produced by the harness mapping.
    for (const slug of dashboardColumns) {
      expect(
        harnessValues.has(slug),
        `dashboard STARTER_COLUMNS has "${slug}" but no harness STARTER_TO_COLUMN entry maps to it — that column can never receive a starter row`,
      ).toBe(true);
    }

    expect(harnessValues.size).toBe(dashboardColumns.size);
  });
});
