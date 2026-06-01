/**
 * Spec-file → dashboard-cell mapping guard.
 *
 * The D6 measurement maps each LGP gold spec FILE to exactly one
 * dashboard feature column (strictly 1:1 — one spec file → one column,
 * one column → one spec file). This guard fails the build if:
 *   - any gold spec file is unmapped (completeness), or
 *   - two spec files claim the same column (uniqueness), or
 *   - a non-gold filename is treated as mapped (no accidental keys).
 *
 * The mapping is the single source of truth for cell assignment; a
 * drifting gold suite (a new spec added, or a column double-claimed)
 * must surface here rather than silently producing an unmeasured /
 * mis-attributed cell downstream in the rollup.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mapSpecFileToCell, allMappedSpecFiles } from "./spec-cell-mapping.js";

const LGP_E2E_DIR = path.resolve(
  __dirname,
  "../../../../integrations/langgraph-python/tests/e2e",
);

function goldSpecFiles(): string[] {
  return fs
    .readdirSync(LGP_E2E_DIR)
    .filter((f) => f.endsWith(".spec.ts"))
    .sort();
}

describe("spec-cell-mapping", () => {
  it("maps every LGP gold spec file to exactly one column", () => {
    const unmapped = goldSpecFiles().filter(
      (f) => mapSpecFileToCell(f) === null,
    );
    expect(unmapped).toEqual([]); // every gold spec must map
  });

  it("never maps two spec files to the same column (strictly 1:1)", () => {
    const columns = goldSpecFiles().map((f) => mapSpecFileToCell(f));
    const dupes = columns.filter(
      (c, i) => c !== null && columns.indexOf(c) !== i,
    );
    // Mapping is strictly 1:1 — one spec file → one column. Any duplicate
    // is a bug.
    expect(dupes).toEqual([]);
  });

  it("does not map a spec file that is not a gold spec", () => {
    expect(mapSpecFileToCell("not-a-real-spec.spec.ts")).toBeNull();
  });

  it("allMappedSpecFiles covers exactly the gold suite", () => {
    // The checked-in mapping must enumerate exactly the gold spec files —
    // no stale keys for retired specs, no missing keys for new ones.
    expect(allMappedSpecFiles()).toEqual(goldSpecFiles());
  });
});
