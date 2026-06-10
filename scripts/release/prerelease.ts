/**
 * Publish a prerelease to npm (publish-only, no build/test/bump).
 *
 * Version bumping is handled by bump-prerelease.ts in the secrets-free CI
 * build job. Build and test also run there. This script receives pre-built,
 * correctly-versioned artifacts and only performs the npm publish step.
 *
 * Always publishes with the "canary" dist-tag.
 *
 * Usage: tsx scripts/release/prerelease.ts --scope <scope from release.config.json> [--dry-run]
 */

import { spawnSync } from "child_process";
import { getCurrentVersion, getPackagesForScope } from "./lib/versions.js";
import { ROOT, loadConfig } from "./lib/config.js";
import type { ReleaseScope } from "./lib/config.js";
import { emitGithubOutputs } from "./lib/github-output.js";

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

// Valid scopes come from release.config.json — the single source of truth.
const VALID_SCOPES = Object.keys(loadConfig().scopes);

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
    emitGithubOutputs({ version: publishVersion, scope });
    console.log("\n[DRY RUN] Exiting.");
    return;
  }

  // NOTE: Version bumping is handled by bump-prerelease.ts in the CI build
  // job (no secrets). Build and test also run there.
  // The publish job receives pre-built artifacts via download-artifact.
  // We intentionally do NOT rebuild/retest here to keep NPM_TOKEN out
  // of the build process tree.

  // Publish each package via pnpm pack + npx npm@11 (OIDC-aware)
  console.log("\nPublishing packages...");
  for (const p of packages) {
    console.log(
      `  Publishing ${p.name}@${p.pkg.version} with tag ${distTag}...`,
    );
    run("pnpm", ["pack"], { cwd: p.dir });
    const tarball = `${p.name.replace("@", "").replace("/", "-")}-${p.pkg.version}.tgz`;
    run(
      "npx",
      [
        "--yes",
        "npm@11.15.0",
        "publish",
        tarball,
        "--tag",
        distTag,
        "--access",
        "public",
      ],
      { cwd: p.dir },
    );
  }

  // The workflow's "Verify publish step emitted version" guard and the
  // prerelease summary read these from steps.publish.outputs.
  emitGithubOutputs({ version: publishVersion, scope });

  console.log(`\nPrerelease published: ${publishVersion} (tag: ${distTag})`);
}

main();
