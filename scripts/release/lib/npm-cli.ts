/**
 * Resolve the pinned npm CLI used to publish to the registry.
 *
 * WHY A PINNED npm AT ALL: npm >= 11.5.1 authenticates via GitHub Actions OIDC
 * trusted publishers, which is what the @copilotkit trusted-publisher records
 * are bound to (see publish-release.yml's header). The runner's bundled npm 10.x
 * cannot publish under that binding, so the publish scripts must invoke a newer
 * npm than the one on PATH. The version pin lives HERE as the single source of
 * truth for both prerelease.ts and publish-release.ts.
 *
 * WHY INSTALL ONCE instead of `npx --yes npm@<version>` per package: npx
 * re-resolves the spec against the registry on EVERY invocation. Measured on a
 * channels canary, that was ~16s of the ~21s spent per package — 9 packages paid
 * ~2.4 minutes of pure npx overhead, and a 16-package monorepo release paid over
 * 4 minutes. Installing into one throwaway prefix collapses all of it into a
 * single ~15s install, after which each publish is just the ~5s of real work.
 *
 * A throwaway prefix (rather than `npm i -g npm@<version>`) keeps this hermetic:
 * it never mutates the ambient npm, so running these scripts locally does not
 * downgrade/upgrade a developer's global npm.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * The npm version used for every registry publish. Must stay >= 11.5.1 for OIDC
 * trusted publishing; bumping it here updates both publish scripts at once.
 */
export const NPM_PUBLISH_VERSION = "11.15.0";

let cachedNpmBin: string | null = null;

/**
 * Install the pinned npm into a temp prefix (once per process) and return the
 * path to its CLI entrypoint. Memoized, so callers may invoke it per package
 * without repaying the install.
 */
export function resolvePublishNpm(): string {
  if (cachedNpmBin) return cachedNpmBin;

  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "cpk-publish-npm-"));
  console.log(`Installing npm@${NPM_PUBLISH_VERSION} into ${prefix}...`);
  const result = spawnSync(
    "npm",
    ["install", "--global", "--prefix", prefix, `npm@${NPM_PUBLISH_VERSION}`],
    { stdio: "inherit", encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to install npm@${NPM_PUBLISH_VERSION} (exit ${result.status}). Refusing to fall back to the ambient npm, which is too old for OIDC trusted publishing.`,
    );
  }

  // Assert the binary exists rather than trusting exit 0: publishing with a
  // missing/!executable path would fail deep inside the per-package loop, after
  // earlier packages had already shipped.
  const bin = path.join(prefix, "bin", "npm");
  if (!fs.existsSync(bin)) {
    throw new Error(
      `Installed npm@${NPM_PUBLISH_VERSION} but ${bin} does not exist.`,
    );
  }

  cachedNpmBin = bin;
  return bin;
}

/** Test-only: drop the memoized binary so each test observes a fresh install. */
export function resetPublishNpmCache(): void {
  cachedNpmBin = null;
}
