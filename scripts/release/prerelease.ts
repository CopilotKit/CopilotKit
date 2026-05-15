/**
 * Publish a prerelease (no git commits, no PRs).
 *
 * Takes the current version for the given scope and appends a canary suffix.
 * If --suffix is provided (e.g. "fix-user-issue"), the version becomes
 * 1.55.2-canary.fix-user-issue. Otherwise it uses a unix timestamp.
 *
 * Always publishes with the "canary" dist-tag.
 *
 * Usage: tsx scripts/release/prerelease.ts --scope <monorepo|angular> [--suffix <label>] [--dry-run]
 */

import { spawnSync } from "child_process";
import {
  getCurrentVersion,
  computePrereleaseVersion,
  bumpPackages,
  getPackagesForScope,
} from "./lib/versions.js";
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
  const suffixIdx = argv.indexOf("--suffix");
  const suffix = suffixIdx !== -1 ? argv[suffixIdx + 1] : undefined;
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
  const currentVersion = getCurrentVersion(scope);
  const prereleaseVersion = computePrereleaseVersion(currentVersion, suffix);
  console.log(`Scope: ${scope}`);
  console.log(`Current version: ${currentVersion}`);
  console.log(`Prerelease version: ${prereleaseVersion}`);
  console.log(`Dist tag: ${distTag}`);

  if (dryRun) {
    console.log("\n[DRY RUN] Would bump these packages:");
    for (const p of getPackagesForScope(scope)) {
      console.log(`  ${p.name}: ${p.pkg.version} -> ${prereleaseVersion}`);
    }
    console.log("\n[DRY RUN] Exiting.");
    return;
  }

  // Bump versions in working directory (no commit)
  const updated = bumpPackages(scope, prereleaseVersion);
  console.log(`\nBumped ${updated.length} packages to ${prereleaseVersion}`);

  // Build all packages
  console.log("\nBuilding packages...");
  run("pnpm", ["run", "build"]);

  // Run tests before publishing
  console.log("\nRunning tests...");
  run("pnpm", ["run", "test"]);

  // Publish each package
  console.log("\nPublishing packages...");
  for (const p of getPackagesForScope(scope)) {
    console.log(
      `  Publishing ${p.name}@${prereleaseVersion} with tag ${distTag}...`,
    );
    run(
      "pnpm",
      ["publish", "--no-git-checks", "--tag", distTag, "--access", "public"],
      { cwd: p.dir },
    );
  }

  console.log(`\nPrerelease published: ${prereleaseVersion} (tag: ${distTag})`);
}

main();
