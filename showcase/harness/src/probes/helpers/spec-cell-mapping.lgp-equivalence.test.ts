/**
 * langgraph-python resolver equivalence gate — the migration's red-green proof.
 *
 * The base+delta resolver MUST reproduce today's committed
 * `spec-cell-mapping.json["langgraph-python"]` BYTE-FOR-BYTE: same 37 spec-paths
 * → same 39 distinct cells. The refactor may not move a single lgp cell — this
 * is lgp's live-proven behavior (41/41 faithful) and must not regress.
 *
 * The lgp resolved mapping = base(lgp on-disk) ⊖ auto-omit(gen-ui-interrupt):
 *   - 39 spec files on disk;
 *   - threadid-frontend-tool-roundtrip has no registry key → unmapped WARN (absent);
 *   - gen-ui-interrupt is skip-listed (NSF) → auto-omitted;
 *   → 37 spec-paths remain, deep-equal to the golden JSON.
 *
 * RED baseline (Step 2): with an EMPTY merged skip-list the auto-omit does NOT
 * fire, so gen-ui-interrupt survives → 38 paths (documented 38-vs-37 RED). The
 * real merged skip-list (with gen-ui-interrupt) closes it to 37 (GREEN).
 */

import { describe, it, expect, afterEach } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadSpecCellMapping } from "./spec-cell-mapping.js";
import {
  __overrideSpecCellMappingForTesting,
  __overrideSpecCellDeltaForTesting,
} from "./spec-cell-mapping.js";
import { loadSkipList, __overrideSkipListForTesting } from "./skip-list.js";
import { __overrideSpecDrivenSlugsForTesting } from "./spec-driven-slugs.js";
import type { D5FeatureType } from "./d5-registry.js";
import baseJson from "./spec-cell-mapping.base.json" with { type: "json" };
import golden from "./spec-cell-mapping.json" with { type: "json" };

// Reset every module-level test-override singleton after each test so that
// parallel multi-file runs cannot leak state across files.
afterEach(() => {
  __overrideSpecCellMappingForTesting(undefined);
  __overrideSpecCellDeltaForTesting(undefined);
  __overrideSkipListForTesting(undefined);
  __overrideSpecDrivenSlugsForTesting(undefined);
});

const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));
const LGP_E2E_DIR = join(
  HELPERS_DIR,
  "../../../../integrations/langgraph-python/tests/e2e",
);

/** List the real lgp on-disk *.spec.ts files as "tests/e2e/<file>" relpaths. */
function listLgpPresentSpecs(): string[] {
  return readdirSync(LGP_E2E_DIR)
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => `tests/e2e/${f}`)
    .sort();
}

const base = baseJson as Record<string, D5FeatureType[]>;
const goldenLgp = (golden as Record<string, Record<string, D5FeatureType[]>>)[
  "langgraph-python"
];

describe("langgraph-python resolver equivalence gate (byte-identical to golden JSON)", () => {
  it("non-vacuous precondition: 39 spec files present on disk", () => {
    // If the lgp tests/e2e dir is missing/empty at harness test-run time the
    // resolver would resolve to an empty map and silently satisfy weaker
    // assertions. Assert the real present-count first so this CANNOT pass vacuously.
    expect(listLgpPresentSpecs().length).toBe(39);
  });

  it("RED baseline: empty merged skip-list leaves gen-ui-interrupt un-omitted → 38 paths", () => {
    const resolved = loadSpecCellMapping("langgraph-python", {
      base,
      delta: {},
      listPresentSpecs: listLgpPresentSpecs,
      mergedSkipList: () => new Set<string>(), // stubbed empty → auto-omit inert
      onUnmapped: () => {},
    });
    // 39 on-disk − 1 (threadid, no registry key) = 38 (gen-ui-interrupt survives).
    expect(Object.keys(resolved).length).toBe(38);
    expect(resolved["tests/e2e/gen-ui-interrupt.spec.ts"]).toBeDefined();
  });

  it("GREEN: real merged skip-list auto-omits gen-ui-interrupt → 37 paths / 39 cells, byte-identical", () => {
    const skipList = loadSkipList();
    let unmappedCount = 0;
    let unmappedSpec = "";
    const resolved = loadSpecCellMapping("langgraph-python", {
      base,
      delta: {},
      listPresentSpecs: listLgpPresentSpecs,
      mergedSkipList: (s) => new Set<string>(skipList[s] ?? []),
      onUnmapped: (_s, rel) => {
        unmappedCount++;
        unmappedSpec = rel;
      },
    });

    // Resolved key set === golden key set (37 paths).
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(goldenLgp).sort());

    // Per-path cell arrays deep-equal the golden.
    for (const path of Object.keys(goldenLgp)) {
      expect(resolved[path]).toEqual(goldenLgp[path]);
    }
    // And the resolver adds no extra paths.
    expect(resolved).toEqual(goldenLgp);

    // Distinct-cell count === 39.
    const distinctCells = new Set<string>();
    for (const cells of Object.values(resolved))
      for (const c of cells) distinctCells.add(c);
    expect(distinctCells.size).toBe(39);

    // gen-ui-interrupt auto-omitted (absent).
    expect(resolved["tests/e2e/gen-ui-interrupt.spec.ts"]).toBeUndefined();

    // threadid-frontend-tool-roundtrip: absent + exactly one unmapped WARN.
    expect(
      resolved["tests/e2e/threadid-frontend-tool-roundtrip.spec.ts"],
    ).toBeUndefined();
    expect(unmappedCount).toBe(1);
    expect(unmappedSpec).toBe(
      "tests/e2e/threadid-frontend-tool-roundtrip.spec.ts",
    );
  });
});
