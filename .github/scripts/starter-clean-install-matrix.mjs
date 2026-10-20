#!/usr/bin/env node
/**
 * Prints the starters that `test_starter-clean-install.yml` must cover, as a
 * JSON array.
 *
 * WHY THIS IS COMPUTED AND NOT WRITTEN DOWN (PE-140)
 * --------------------------------------------------
 * `test_smoke-starter.yml` carries a hand-maintained list of starter slugs.
 * Twenty-two starters live under `examples/integrations/`; that list names
 * fourteen. Both starters that reached a developer broken — a2a-middleware
 * (PE-129) and claude-sdk-python (PE-38) — were in the eight the list omits.
 * The hole was not that the smoke job was wrong, it was that the list was a
 * list.
 *
 * So this matrix is DERIVED: every directory under examples/integrations/ that
 * the smoke matrix does not already build. Add a starter and it is covered on
 * the next run with no edit here. Drop one from the smoke matrix and it lands
 * here instead. Neither list can quietly stop covering a starter.
 *
 * Usage:
 *   node .github/scripts/starter-clean-install-matrix.mjs            # uncovered
 *   node .github/scripts/starter-clean-install-matrix.mjs --all      # every starter
 *   node .github/scripts/starter-clean-install-matrix.mjs --explain  # human readable
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const integrationsDir = path.join(repoRoot, "examples", "integrations");
const smokeWorkflow = path.join(
  repoRoot,
  ".github",
  "workflows",
  "test_smoke-starter.yml",
);

export function allStarters(dir = integrationsDir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

/**
 * The slugs `test_smoke-starter.yml` builds. Read out of the `smoke-starter`
 * job's matrix block rather than duplicated here, so this file cannot disagree
 * with the workflow it is deferring to.
 */
export function smokeCoveredStarters(
  workflowPath = smokeWorkflow,
  starters = allStarters(),
) {
  const text = fs.readFileSync(workflowPath, "utf8");
  // The `smoke-starter` job's `strategy.matrix.starter:` block: a `starter:`
  // key on its own line followed by a run of `- <slug>` items. The production
  // -image job builds its list in shell, so it has no such block to confuse
  // this. Indentation is captured rather than hard-coded so a reformat of the
  // workflow does not silently empty the set.
  const block = text.match(/^(\s+)starter:\n((?:\s+- \S+\n)+)/m);
  if (!block) {
    throw new Error(
      `Could not read the smoke-starter matrix out of ${path.relative(repoRoot, workflowPath)}. ` +
        `If that job's matrix moved, update .github/scripts/starter-clean-install-matrix.mjs — ` +
        `do NOT fall back to an empty set, which would silently double every run.`,
    );
  }
  const slugs = block[2]
    .split("\n")
    .map((l) => l.trim().replace(/^- /, ""))
    .filter(Boolean);

  const unknown = slugs.filter((s) => !starters.includes(s));
  if (unknown.length) {
    throw new Error(
      `test_smoke-starter.yml lists starters that do not exist: ${unknown.join(", ")}`,
    );
  }
  return slugs.sort();
}

function main() {
  const starters = allStarters();
  const covered = smokeCoveredStarters(smokeWorkflow, starters);
  const uncovered = starters.filter((s) => !covered.includes(s));

  if (process.argv.includes("--explain")) {
    console.log(`starters under examples/integrations/: ${starters.length}`);
    console.log(
      `built by test_smoke-starter.yml (${covered.length}): ${covered.join(", ")}`,
    );
    console.log(
      `clean-install matrix (${uncovered.length}): ${uncovered.join(", ")}`,
    );
    return;
  }
  console.log(
    JSON.stringify(process.argv.includes("--all") ? starters : uncovered),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
