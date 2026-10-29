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
 * `--rc <X.Y.Z>` bumps one scope to the next unpublished release candidate of
 * that version (`X.Y.Z-rc.N`) instead of a canary. release / rc passes the
 * name of the release-line branch it runs on (e.g. `2.0.0`).
 *
 * Usage: tsx scripts/release/bump-prerelease.ts --scope <scope from release.config.json | all> [--suffix <label> | --rc <X.Y.Z>]
 */

import {
  getCurrentVersion,
  getPackagesForScope,
  computePrereleaseVersion,
  computeNextRcVersion,
  resolvePrereleaseId,
  bumpPackages,
  findCrossScopePins,
} from "./lib/versions.js";
import { ALL_SCOPES, loadConfig, resolveScopes } from "./lib/config.js";
import type { ReleaseScope } from "./lib/config.js";
import { fetchPublishedVersions } from "./lib/npm-registry.js";

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

/**
 * The next `<base>-rc.N` none of the scope's packages has published yet.
 *
 * Refuses once `base` itself is out: a release line's branch outlives its
 * stable release, and RCs of a shipped version would only confuse installs.
 */
async function resolveNextRcVersion(
  scope: ReleaseScope,
  base: string,
): Promise<string> {
  const published = (
    await Promise.all(
      getPackagesForScope(scope).map((p) => fetchPublishedVersions(p.name)),
    )
  ).flat();
  if (published.includes(base)) {
    throw new Error(
      `${base} is already released; there is nothing left to publish release candidates for.`,
    );
  }
  return computeNextRcVersion(base, published);
}

async function main() {
  const argv = process.argv.slice(2);
  const suffixIdx = argv.indexOf("--suffix");
  const suffix = suffixIdx !== -1 ? argv[suffixIdx + 1] : undefined;
  const rcIdx = argv.indexOf("--rc");
  const rcBase = rcIdx !== -1 ? argv[rcIdx + 1] : undefined;
  const scopeIdx = argv.indexOf("--scope");
  const selector = scopeIdx !== -1 ? argv[scopeIdx + 1] : null;
  const usage = `Usage: bump-prerelease.ts --scope <${[...VALID_SCOPES, ALL_SCOPES].join("|")}> [--suffix <label> | --rc <X.Y.Z>]`;

  if (!selector) {
    console.error(usage);
    process.exit(1);
  }

  let scopes: ReturnType<typeof resolveScopes>;
  try {
    scopes = resolveScopes(selector);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage);
    process.exit(1);
  }

  if (rcIdx !== -1) {
    // An RC names one version, and the scopes carry independent version lines.
    if (selector === ALL_SCOPES || suffixIdx !== -1) {
      console.error("--rc takes a single scope and no --suffix.");
      process.exit(1);
    }
    if (!rcBase || !/^\d+\.\d+\.\d+$/.test(rcBase)) {
      console.error(`--rc needs a stable X.Y.Z version (got '${rcBase}').`);
      process.exit(1);
    }
    const [scope] = scopes;
    const version = await resolveNextRcVersion(scope, rcBase);
    console.log(`[${scope}] release candidate: ${version}`);
    const updated = bumpPackages(scope, version);
    console.log(`Bumped ${updated.length} packages to ${version}`);
    warnOnCrossScopePins(scopes);
    return;
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

// Explicit non-zero exit: a rejected registry lookup must fail the step.
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
