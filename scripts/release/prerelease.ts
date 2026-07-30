/**
 * Publish a prerelease to npm (publish-only, no build/test/bump).
 *
 * Version bumping is handled by bump-prerelease.ts in the secrets-free CI
 * build job. Build and test also run there. This script receives pre-built,
 * correctly-versioned artifacts and only performs the npm publish step.
 *
 * Always publishes with the "canary" dist-tag.
 *
 * Multi-scope caveat (scope=all): packages publish scope by scope, and the
 * cross-scope dependency graph has cycles (runtime -> channels-intelligence,
 * channels-core -> core), so NO order avoids publishing a package before the
 * same-run version it pins. A run that dies partway therefore leaves published
 * canaries pinning versions that never shipped — uninstallable until the rest
 * lands. There is no resume: npm rejects republishing a version, so retry with a
 * NEW suffix and abandon the half-published id.
 *
 * Usage: tsx scripts/release/prerelease.ts --scope <scope from release.config.json | all> [--dry-run]
 */

import { spawnSync } from "child_process";
import { getCurrentVersion, getPackagesForScope } from "./lib/versions.js";
import type { PublishablePackage } from "./lib/versions.js";
import { ALL_SCOPES, ROOT, loadConfig, resolveScopes } from "./lib/config.js";
import type { ReleaseScope } from "./lib/config.js";
import { emitGithubOutputs } from "./lib/github-output.js";
import { resolvePublishNpm } from "./lib/npm-cli.js";

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
  const selector = scopeIdx !== -1 ? argv[scopeIdx + 1] : null;
  const usage = `Usage: prerelease.ts --scope <${[...VALID_SCOPES, ALL_SCOPES].join("|")}> [--dry-run]`;

  if (!selector) {
    console.error(usage);
    process.exit(1);
  }

  let scopes: ReleaseScope[];
  try {
    scopes = resolveScopes(selector);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage);
    process.exit(1);
  }

  const config = loadConfig();
  const distTag = config.prereleaseTag;

  // Read the versions from package.json — already bumped by bump-prerelease.ts
  // in the CI build job.
  const scopeVersions = scopes.map((scope) => {
    const version = getCurrentVersion(scope);
    if (!version) {
      console.error(
        `Scope "${scope}" version source has no version field; refusing to publish.`,
      );
      process.exit(1);
    }
    return { scope, version };
  });

  // Union of every scope's packages, in per-scope publish order. Deduplicated by
  // name: a package enrolled in two scopes must be published once, not twice
  // (the second publish would fail on an already-taken version).
  const packages: PublishablePackage[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    for (const p of getPackagesForScope(scope)) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      packages.push(p);
    }
  }
  if (packages.length === 0) {
    console.error(
      `No packages found for scope "${selector}" — refusing to emit a version for a publish that did nothing.`,
    );
    process.exit(1);
  }

  // `version` stays single-valued for the workflow's emitted-version guard and
  // the stable-shaped summary; `versions` carries every scope for a multi-scope
  // canary, where no single version describes the publish.
  const publishVersion = scopeVersions[0].version;
  const publishVersions = scopeVersions
    .map(({ scope, version }) => `${scope}@${version}`)
    .join(" ");
  console.log(`Scope: ${selector} -> ${scopes.join(", ")}`);
  console.log(`Publishing versions: ${publishVersions}`);
  console.log(`Dist tag: ${distTag}`);

  if (dryRun) {
    console.log("\n[DRY RUN] Would publish these packages:");
    for (const p of packages) {
      console.log(`  ${p.name}@${p.pkg.version}`);
    }
    // Emitting in dry-run is safe — the publish workflow gates both the
    // publish step and the verify guard on `inputs.dry-run != true`, so this
    // only serves local/e2e verification of the output contract.
    emitGithubOutputs({
      version: publishVersion,
      versions: publishVersions,
      scope: selector,
    });
    console.log("\n[DRY RUN] Exiting.");
    return;
  }

  // NOTE: Version bumping is handled by bump-prerelease.ts in the CI build
  // job (no secrets). Build and test also run there.
  // The publish job receives pre-built artifacts via download-artifact.
  // We intentionally do NOT rebuild/retest here to keep NPM_TOKEN out
  // of the build process tree.

  // Publish each package via pnpm pack + the pinned OIDC-aware npm. Resolved
  // ONCE up front: see lib/npm-cli.ts for why this is not `npx npm@<v>` per
  // package (npx re-resolved the spec every time, ~16s of each package's ~21s).
  const npmBin = resolvePublishNpm();
  console.log("\nPublishing packages...");
  for (const p of packages) {
    console.log(
      `  Publishing ${p.name}@${p.pkg.version} with tag ${distTag}...`,
    );
    run("pnpm", ["pack"], { cwd: p.dir });
    const tarball = `${p.name.replace("@", "").replace("/", "-")}-${p.pkg.version}.tgz`;
    run(npmBin, ["publish", tarball, "--tag", distTag, "--access", "public"], {
      cwd: p.dir,
    });
  }

  // The workflow's "Verify publish step emitted version" guard and the
  // prerelease summary read these from steps.publish.outputs.
  emitGithubOutputs({
    version: publishVersion,
    versions: publishVersions,
    scope: selector,
  });

  console.log(`\nPrerelease published: ${publishVersions} (tag: ${distTag})`);
}

main();
