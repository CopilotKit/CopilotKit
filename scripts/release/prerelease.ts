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

import { spawn } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCurrentVersion,
  getPackagesForScope,
  pinPrereleaseDependencies,
  validatePrereleaseDependencyPins,
} from "./lib/versions.js";
import type { PrereleaseManifest, PublishablePackage } from "./lib/versions.js";
import { ALL_SCOPES, ROOT, loadConfig, resolveScopes } from "./lib/config.js";
import type { ReleaseScope } from "./lib/config.js";
import { emitGithubOutputs } from "./lib/github-output.js";
import { packPackage } from "./lib/pack-workspace.js";
import { resolvePublishNpm } from "./lib/npm-cli.js";
import { mapWithConcurrency } from "./lib/concurrency.js";

/**
 * How many packages to publish at once. Each one is dominated by a registry
 * round-trip, so a small pool removes most of the serial wait without hammering
 * npm. Packing happens up front so the complete dependency graph can be
 * validated before any package reaches the registry.
 */
const PUBLISH_CONCURRENCY = Number(
  process.env.CANARY_PUBLISH_CONCURRENCY ?? "4",
);

/**
 * Run a command to completion, capturing its output.
 *
 * Output is CAPTURED rather than inherited, then replayed as one block per
 * package once that package finishes. With a pool in flight, inheriting stdio
 * would interleave several npm publishes line-by-line and make the log
 * unreadable — and this log is the only forensic record when a canary
 * half-publishes.
 */
function runCaptured(
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd ?? ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      if (status === 0) {
        resolve(output);
        return;
      }
      reject(
        new Error(
          `Command failed (exit ${status}): ${cmd} ${args.join(" ")}\n${output}`,
        ),
      );
    });
  });
}

// Valid scopes come from release.config.json — the single source of truth.
const VALID_SCOPES = Object.keys(loadConfig().scopes);

async function main() {
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

  // NOTE: Version bumping is handled by bump-prerelease.ts in the CI build
  // job (no secrets). Build and test also run there.
  // The publish job receives pre-built artifacts via download-artifact.
  // We intentionally do NOT rebuild/retest here to keep NPM_TOKEN out
  // of the build process tree.

  // Snapshot source manifests because exact canary pins are a packaging concern,
  // not authored package.json changes. They are applied only long enough to pack
  // every artifact, then restored before publishing the already-validated
  // tarballs. Stable publishing never calls this script.
  const originalManifests = new Map(
    packages.map((p) => [p.pkgJsonPath, readFileSync(p.pkgJsonPath, "utf8")]),
  );
  const temp = mkdtempSync(join(tmpdir(), "copilotkit-prerelease-"));

  try {
    const packedPackages: {
      package: PublishablePackage;
      manifest: PrereleaseManifest;
      tarball: string;
    }[] = [];

    try {
      const pins = pinPrereleaseDependencies(packages);
      console.log(
        `\nExact-pinned ${pins.length} dependency edge(s) within this canary publish set.`,
      );

      // Pack the ENTIRE set before publishing any package. This makes the check
      // atomic with respect to validation: an invalid packed graph cannot leave
      // a half-published canary behind.
      for (const p of packages) {
        const { manifest, tarball } = packPackage(p.name, temp);
        packedPackages.push({
          package: p,
          manifest: manifest as PrereleaseManifest,
          tarball,
        });
      }

      const manifests = new Map(
        packedPackages.map(({ manifest }) => [manifest.name, manifest]),
      );
      const problems = validatePrereleaseDependencyPins(manifests);
      if (problems.length > 0) {
        throw new Error(
          `Prerelease dependency validation failed before npm publish:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
        );
      }
      console.log(
        `Validated ${packedPackages.length} packed canary manifest(s): every dependency within the publish set is exact.`,
      );
    } finally {
      for (const p of packages) {
        const original = originalManifests.get(p.pkgJsonPath);
        if (original === undefined) continue;
        writeFileSync(p.pkgJsonPath, original);
        p.pkg = JSON.parse(original);
      }
    }

    if (dryRun) {
      console.log("\n[DRY RUN] Validated these packages:");
      for (const { manifest } of packedPackages) {
        console.log(`  ${manifest.name}@${manifest.version}`);
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

    // Publish the preflighted tarballs with the pinned OIDC-aware npm. Packages
    // go out with bounded concurrency because each is dominated by a registry
    // round-trip. This does not weaken an ordering invariant: the cross-scope
    // graph has cycles, so no serial order was safe either.
    const npmBin = resolvePublishNpm();
    console.log(
      `\nPublishing ${packedPackages.length} package(s), ${PUBLISH_CONCURRENCY} at a time...`,
    );
    const results = await mapWithConcurrency(
      packedPackages,
      PUBLISH_CONCURRENCY,
      async ({ package: p, manifest, tarball }) => {
        const label = `${manifest.name}@${manifest.version}`;
        await runCaptured(
          npmBin,
          ["publish", tarball, "--tag", distTag, "--access", "public"],
          { cwd: p.dir },
        );
        console.log(`  Published ${label} with tag ${distTag}`);
        return label;
      },
    );

    // Report EVERY failure rather than just the first: npm refuses to republish
    // a version, so a partially-published canary id must be abandoned wholesale.
    const failures = results.filter((result) => result.error);
    if (failures.length > 0) {
      console.error(
        `\n${failures.length} of ${packedPackages.length} package(s) failed to publish:`,
      );
      for (const { item, error } of failures) {
        console.error(
          `\n--- ${item.manifest.name}@${item.manifest.version} ---`,
        );
        console.error(error instanceof Error ? error.message : error);
      }
      throw new Error(
        `Prerelease aborted: ${failures.length} package(s) failed. This canary id is now half-published and cannot be resumed — retry with a NEW suffix.`,
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
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

// Explicit non-zero exit: an unhandled rejection from the now-async main would
// otherwise let the publish step pass while packages failed to publish.
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
