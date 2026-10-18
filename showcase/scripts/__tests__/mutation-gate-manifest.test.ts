/**
 * The CHEAP half of the mutation gate, run by `showcase_validate.yml`'s
 * existing `showcase/scripts` vitest step.
 *
 * The gate itself (applying mutations and re-running suites) needs the
 * `shell-dashboard` and `harness` packages installed and their pretest
 * artifacts generated, and no CI job runs those unit suites yet — see
 * `mutation-gate/mutation-gate.ts` and the report for that dependency. What
 * DOES gate today is manifest integrity:
 *
 *   1. the manifest is structurally valid, and
 *   2. every mutation's anchor string still occurs EXACTLY ONCE in its target
 *      file at HEAD.
 *
 * (2) is the failure mode that would otherwise rot silently. A refactor that
 * moves `const lastIdx = …` does not break any test — it just means the
 * mutation for that guard no longer applies, and the day someone runs the gate
 * they get a green report from a manifest that tests nothing. Catching it here
 * costs milliseconds and no test execution.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  describeAnchorProblem,
  loadManifest,
  resolveAnchors,
  validateManifest,
} from "../mutation-gate/manifest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
}).trim();

describe("mutation-gate manifest", () => {
  const manifest = loadManifest();

  it("is structurally valid", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("declares at least one known-toothless guard, so the ledger is honest", () => {
    // A manifest in which every mutation is killed is either a genuinely
    // airtight suite or — far more likely — a manifest that only records the
    // mutations someone already knew would fail. The seeded set deliberately
    // carries the survivors too; if this ever drops to zero, confirm it is
    // because the gaps were CLOSED (each `survive` entry promoted to `kill`)
    // and not because they were deleted.
    const survivors = manifest.mutants.filter((m) => m.expect === "survive");
    expect(survivors.length).toBeGreaterThan(0);
  });

  it("every anchor resolves exactly once against HEAD", () => {
    const problems = resolveAnchors(manifest, REPO_ROOT);
    expect(
      problems.map(describeAnchorProblem).join("\n"),
      problems.length === 0
        ? ""
        : `mutation-gate/mutants.json has rotted against the current source. ` +
            `Each mutation below no longer applies, so the guard it checks is ` +
            `unmeasured. Re-anchor or delete the entry:`,
    ).toBe("");
  });

  it("every target file is inside showcase/ and tracked by git", () => {
    const files = [
      ...new Set(manifest.mutants.flatMap((m) => m.edits.map((e) => e.file))),
    ];
    for (const f of files) {
      expect(f.startsWith("showcase/"), `${f} is outside showcase/`).toBe(true);
      expect(() =>
        execFileSync("git", ["ls-files", "--error-unmatch", f], {
          cwd: REPO_ROOT,
          stdio: "ignore",
        }),
      ).not.toThrow();
    }
  });

  it("every declared suite package exists and names a vitest binary path", () => {
    for (const [name, s] of Object.entries(manifest.suites)) {
      expect(
        path.isAbsolute(s.package),
        `suite ${name}: \`package\` must be repo-relative`,
      ).toBe(false);
      expect(s.vitestBin, `suite ${name}`).toMatch(/vitest$/);
    }
  });
});
