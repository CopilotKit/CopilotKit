/**
 * Build the community packages in a release scope (runs in the publish
 * workflow's build job, right after the root build).
 *
 * The root build is `nx run-many -t build --projects=packages/**`. Community
 * packages live under `community/` and are deliberately not pnpm workspace
 * members (see community/README.md), so nx never sees them and that build
 * leaves them unbuilt. `pnpm pack` would then publish a package with no
 * `dist`. Each one has its own pnpm root and lockfile, so it is installed and
 * built inside its own folder here.
 *
 * Does nothing, successfully, when the scope has no community packages, which
 * is every scope that exists today.
 *
 * Usage: tsx scripts/release/build-community-packages.ts --scope <scope from release.config.json | all | learning-preview>
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT, resolveScopes } from "./lib/config.js";
import { getCommunityPackagesForScopes } from "./lib/versions.js";

function main() {
  const argv = process.argv.slice(2);
  const scopeIdx = argv.indexOf("--scope");
  const selector = scopeIdx >= 0 ? argv[scopeIdx + 1] : undefined;
  if (!selector) {
    console.error(
      "Usage: tsx scripts/release/build-community-packages.ts --scope <scope | all | learning-preview>",
    );
    process.exit(1);
  }

  const packages = getCommunityPackagesForScopes(resolveScopes(selector));
  if (packages.length === 0) {
    console.log(
      `No community packages in scope "${selector}"; nothing to build.`,
    );
    return;
  }

  for (const pkg of packages) {
    const where = path.relative(ROOT, pkg.dir);
    console.log(`\nBuilding community package ${pkg.name} (${where})`);
    // --frozen-lockfile: the package's own committed lockfile must already
    // satisfy its package.json, exactly as the test / community workflow checks.
    execFileSync("pnpm", ["install", "--frozen-lockfile"], {
      cwd: pkg.dir,
      stdio: "inherit",
    });
    execFileSync("pnpm", ["run", "build"], { cwd: pkg.dir, stdio: "inherit" });
  }
}

main();
