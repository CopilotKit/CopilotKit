/**
 * Drift test — harness `REGISTRY_TO_D5` vs dashboard `CATALOG_TO_D5_KEY`.
 *
 * The harness emits PB rows keyed `d5:<slug>/<d5FeatureType>` keyed by
 * REGISTRY feature ID via `REGISTRY_TO_D5`. The dashboard reads those
 * rows via its own `CATALOG_TO_D5_KEY` map. The two maps are documented
 * mirrors but the dashboard lives outside this pnpm workspace (its
 * Dockerfile uses `npm ci`), so the type system can't link them.
 *
 * If they drift:
 *   - Keys in dashboard but not harness ⇒ orphan: dashboard reads a row
 *     nothing emits; cells stay at D4 forever (regression flavour of
 *     the historical `hitl: ["hitl-steps"]` bug).
 *   - Keys in harness but not dashboard ⇒ stranded: harness emits rows
 *     no cell knows to read; cells max out at D4 even when D5 is green.
 *   - Value mismatch on shared key ⇒ same orphan/stranded effect for
 *     just that mapping.
 *
 * This test catches all three by asserting structural equality. The
 * dashboard side is parsed via fs (no cross-package import — see the
 * exported-comment on `REGISTRY_TO_D5` for why).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REGISTRY_TO_D5 } from "./d5-feature-mapping.js";

const DASHBOARD_FILE = resolve(
  __dirname,
  "../../../../shell-dashboard/src/lib/live-status.ts",
);

/** Parse `CATALOG_TO_D5_KEY` object literal out of the dashboard source. */
function parseDashboardCatalogMap(): Record<string, string[]> {
  const src = readFileSync(DASHBOARD_FILE, "utf8");
  const block = src.match(/CATALOG_TO_D5_KEY[^=]+=\s*\{([\s\S]+?)\n\};/);
  if (!block || !block[1]) {
    throw new Error(
      "drift parser: could not locate CATALOG_TO_D5_KEY in dashboard source — " +
        "if the dashboard file's shape changed, update the regex in this test.",
    );
  }
  const out: Record<string, string[]> = {};
  // Each entry: `"key"` or `key` (unquoted shorthand) followed by `: [string array]`.
  const entries = block[1].matchAll(
    /(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_-]*))\s*:\s*\[([^\]]+)\]/g,
  );
  for (const match of entries) {
    const key = (match[1] ?? match[2]) as string;
    const values = Array.from(
      match[3].matchAll(/"([^"]+)"/g),
      (m) => m[1] as string,
    );
    out[key] = values;
  }
  return out;
}

function normalizeMap(
  m: Record<string, readonly string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(m).sort()) {
    out[k] = [...m[k]].sort();
  }
  return out;
}

describe("d5-mapping-drift", () => {
  it("dashboard CATALOG_TO_D5_KEY structurally mirrors harness REGISTRY_TO_D5", () => {
    const harnNorm = normalizeMap(
      REGISTRY_TO_D5 as Record<string, readonly string[]>,
    );
    const dashNorm = normalizeMap(parseDashboardCatalogMap());
    expect(dashNorm).toEqual(harnNorm);
  });
});
