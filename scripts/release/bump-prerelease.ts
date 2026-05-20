/**
 * Bump package versions for a prerelease (runs in the secrets-free build job).
 *
 * This is extracted from prerelease.ts so that version bumping happens before
 * the build, in a job that has no access to NPM_TOKEN or other publish secrets.
 * The publish job then receives pre-built, correctly-versioned artifacts.
 *
 * Usage: tsx scripts/release/bump-prerelease.ts --scope <monorepo|angular> [--suffix <label>]
 */

import {
  getCurrentVersion,
  computePrereleaseVersion,
  bumpPackages,
  getPackagesForScope,
} from "./lib/versions.js";
import { loadConfig, type ReleaseScope } from "./lib/config.js";

const VALID_SCOPES = ["monorepo", "angular"];

function main() {
  const argv = process.argv.slice(2);
  const suffixIdx = argv.indexOf("--suffix");
  const suffix = suffixIdx !== -1 ? argv[suffixIdx + 1] : undefined;
  const scopeIdx = argv.indexOf("--scope");
  const scope = (
    scopeIdx !== -1 ? argv[scopeIdx + 1] : null
  ) as ReleaseScope | null;

  if (!scope || !VALID_SCOPES.includes(scope)) {
    console.error(
      `Usage: bump-prerelease.ts --scope <${VALID_SCOPES.join("|")}> [--suffix <label>]`,
    );
    process.exit(1);
  }

  const config = loadConfig();
  const distTag = config.prereleaseTag;
  const currentVersion = getCurrentVersion(scope);
  const prereleaseVersion = computePrereleaseVersion(currentVersion, suffix);
  console.log(`Scope: ${scope}`);
  console.log(`Current version: ${currentVersion}`);
  console.log(`Prerelease version: ${prereleaseVersion}`);
  console.log(`Dist tag: ${distTag}`);

  // Bump versions in working directory (no commit)
  const updated = bumpPackages(scope, prereleaseVersion);
  console.log(`\nBumped ${updated.length} packages to ${prereleaseVersion}`);
  for (const p of updated) {
    console.log(`  ${p.name}: ${p.oldVersion} -> ${p.newVersion}`);
  }
}

main();
