/**
 * Publish a prerelease to npm (publish-only, no build/test/bump).
 *
 * Version bumping is handled by bump-prerelease.ts in the secrets-free CI
 * build job. Build and test also run there. This script receives pre-built,
 * correctly-versioned artifacts and only performs the npm publish step.
 *
 * Always publishes with the "canary" dist-tag.
 *
 * Usage: tsx scripts/release/prerelease.ts --scope <monorepo|angular> [--dry-run]
 */

import { spawnSync } from "child_process";
import { getCurrentVersion, getPackagesForScope } from "./lib/versions.js";
import { ROOT, loadConfig, type ReleaseScope } from "./lib/config.js";

function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  const result = spawnSync(cmd, args, {
    cwd: opts?.cwd ?? ROOT,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
  return result;
}

const VALID_SCOPES = ["monorepo", "angular"];

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const scopeIdx = argv.indexOf("--scope");
  const scope = (
    scopeIdx !== -1 ? argv[scopeIdx + 1] : null
  ) as ReleaseScope | null;

  if (!scope || !VALID_SCOPES.includes(scope)) {
    console.error(
      `Usage: prerelease.ts --scope <${VALID_SCOPES.join("|")}> [--suffix <label>] [--dry-run]`,
    );
    process.exit(1);
  }

  const config = loadConfig();
  const distTag = config.prereleaseTag;

  // Read the version from package.json — already bumped by bump-prerelease.ts
  // in the CI build job.
  const packages = getPackagesForScope(scope);
  const publishVersion = packages[0]?.pkg.version ?? getCurrentVersion(scope);
  console.log(`Scope: ${scope}`);
  console.log(`Publishing version: ${publishVersion}`);
  console.log(`Dist tag: ${distTag}`);

  if (dryRun) {
    console.log("\n[DRY RUN] Would publish these packages:");
    for (const p of packages) {
      console.log(`  ${p.name}@${p.pkg.version}`);
    }
    console.log("\n[DRY RUN] Exiting.");
    return;
  }

  // NOTE: Version bumping is handled by bump-prerelease.ts in the CI build
  // job (no secrets). Build and test also run there.
  // The publish job receives pre-built artifacts via download-artifact.
  // We intentionally do NOT rebuild/retest here to keep NPM_TOKEN out
  // of the build process tree.

  // Publish each package
  console.log("\nPublishing packages...");
  for (const p of packages) {
    console.log(
      `  Publishing ${p.name}@${p.pkg.version} with tag ${distTag}...`,
    );
    run(
      "pnpm",
      ["publish", "--no-git-checks", "--tag", distTag, "--access", "public"],
      { cwd: p.dir },
    );
  }

  console.log(`\nPrerelease published: ${publishVersion} (tag: ${distTag})`);
}

main();
