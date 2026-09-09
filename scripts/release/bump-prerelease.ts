/**
 * Bump package versions for a prerelease (runs in the secrets-free build job).
 *
 * This is extracted from prerelease.ts so that version bumping happens before
 * the build, in a job that has no access to NPM_TOKEN or other publish secrets.
 * The publish job then receives pre-built, correctly-versioned artifacts.
 *
 * Every scope bumped in one invocation shares a single prerelease id, so a
 * multi-scope canary is one identifiable set of versions.
 *
 * Usage: tsx scripts/release/bump-prerelease.ts --scope <scope from release.config.json | all> [--suffix <label>]
 */

import {
  getCurrentVersion,
  computePrereleaseVersion,
  resolvePrereleaseId,
  bumpPackages,
  findCrossScopePins,
} from "./lib/versions.js";
import { ALL_SCOPES, loadConfig, resolveScopes } from "./lib/config.js";

// Valid scopes come from release.config.json — the single source of truth.
const VALID_SCOPES = Object.keys(loadConfig().scopes);

/**
 * Warn about cross-scope pins that won't carry a version from this run. Silent
 * before this warning existed: a `monorepo` canary of a commit that changed the
 * runtime↔channels contract shipped pinned to the pre-change channels release,
 * and the mismatch only surfaced as a TypeError in a consumer's app.
 *
 * A warning, not a failure: a single-scope canary is still the right call when
 * the change doesn't cross the edge.
 */
function warnOnCrossScopePins(scopes: ReturnType<typeof resolveScopes>): void {
  const pins = findCrossScopePins(scopes);
  if (pins.length === 0) return;

  console.log(
    `\n${pins.length} cross-scope pin(s) will NOT carry a version from this publish:`,
  );
  for (const pin of pins) {
    const remedy =
      pin.reason === "literal-range"
        ? `That range is written literally in ${pin.from}'s package.json, so no bump rewrites it — scope=${ALL_SCOPES} does NOT fix this. Convert the dep to the workspace: protocol.`
        : `If this commit changed both sides, re-run the canary with scope=${ALL_SCOPES}.`;
    console.log(
      `::warning::${pin.from} depends on ${pin.dep} (scope "${pin.depScope}") — the published manifest will pin ${pin.dep}@${pin.resolvesTo}, so this canary is only usable with that release. ${remedy}`,
    );
  }
}

function main() {
  const argv = process.argv.slice(2);
  const suffixIdx = argv.indexOf("--suffix");
  const suffix = suffixIdx !== -1 ? argv[suffixIdx + 1] : undefined;
  const scopeIdx = argv.indexOf("--scope");
  const selector = scopeIdx !== -1 ? argv[scopeIdx + 1] : null;

  if (!selector) {
    console.error(
      `Usage: bump-prerelease.ts --scope <${[...VALID_SCOPES, ALL_SCOPES].join("|")}> [--suffix <label>]`,
    );
    process.exit(1);
  }

  let scopes: ReturnType<typeof resolveScopes>;
  try {
    scopes = resolveScopes(selector);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(
      `Usage: bump-prerelease.ts --scope <${[...VALID_SCOPES, ALL_SCOPES].join("|")}> [--suffix <label>]`,
    );
    process.exit(1);
  }

  const distTag = loadConfig().prereleaseTag;
  // One id for every scope in this run (see resolvePrereleaseId).
  const id = resolvePrereleaseId(suffix);
  console.log(`Scope: ${selector} -> ${scopes.join(", ")}`);
  console.log(`Prerelease id: ${id}`);
  console.log(`Dist tag: ${distTag}`);

  for (const scope of scopes) {
    const currentVersion = getCurrentVersion(scope);
    const prereleaseVersion = computePrereleaseVersion(currentVersion, id);
    console.log(
      `\n[${scope}] current version: ${currentVersion} -> prerelease version: ${prereleaseVersion}`,
    );

    // Bump versions in working directory (no commit)
    const updated = bumpPackages(scope, prereleaseVersion);
    console.log(`Bumped ${updated.length} packages to ${prereleaseVersion}`);
    for (const p of updated) {
      console.log(`  ${p.name}: ${p.oldVersion} -> ${p.newVersion}`);
    }
  }

  // After every bump: the surviving cross-scope pins are now final.
  warnOnCrossScopePins(scopes);
}

main();
