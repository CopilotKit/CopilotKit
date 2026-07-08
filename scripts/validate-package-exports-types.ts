import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Regression guard for CopilotKit issue #3324.
//
// TypeScript ignores the top-level `types` field once a package.json `exports`
// map exists, so under `moduleResolution` bundler/node16/nodenext every export
// subpath that resolves to runtime JavaScript needs its OWN `types` condition.
// tsdown does not emit one automatically (scripts/tsdown-exports.mjs adds it),
// and hand-maintained maps can forget it — either way strict-exports tooling
// (e.g. the Backstage CLI) then reports "has no exported member" for every
// named import. This script scans every publishable package and fails if any
// JS export is missing a valid `types` condition.
// ---------------------------------------------------------------------------

/** A value in a package.json `exports` map. */
export type ExportsEntry = string | { [condition: string]: ExportsEntry };

export interface Violation {
  package: string;
  /** Subpath plus the condition trail, e.g. `". > import"`. */
  subpath: string;
  reason: string;
}

const PACKAGES_DIR = path.resolve(__dirname, "../packages");

const JS_TARGET = /\.(mjs|cjs|js)$/;
const DECLARATION_TARGET = /\.d\.(mts|cts|ts)$/;

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

/**
 * Return every entry in one package's `exports` map that resolves to runtime
 * JavaScript without a reachable `types` condition, or whose `types` condition
 * does not point at a declaration file.
 */
export function findExportsTypeViolations(
  packageName: string,
  exportsMap: unknown,
): Violation[] {
  const violations: Violation[] = [];
  if (exportsMap && typeof exportsMap === "object") {
    for (const [subpath, entry] of Object.entries(exportsMap)) {
      walk(entry, subpath, packageName, violations);
    }
  }
  return violations;
}

function walk(
  entry: unknown,
  trail: string,
  packageName: string,
  out: Violation[],
): void {
  if (typeof entry === "string") {
    if (JS_TARGET.test(entry)) {
      out.push({
        package: packageName,
        subpath: trail,
        reason: `JS target "${entry}" has no "types" condition`,
      });
    }
    return;
  }
  if (!entry || typeof entry !== "object") return;

  const conditions = Object.entries(entry);

  // An explicit `types` condition at this level covers this branch; just check
  // that it points at a declaration file (`are-the-types-wrong` validates the
  // ESM/CJS flavor separately).
  const typesEntry = conditions.find(([condition]) => condition === "types");
  if (typesEntry) {
    const typesTarget = typesEntry[1];
    if (
      typeof typesTarget === "string" &&
      !DECLARATION_TARGET.test(typesTarget)
    ) {
      out.push({
        package: packageName,
        subpath: `${trail} > types`,
        reason: `"types" target "${typesTarget}" is not a declaration file`,
      });
    }
    return;
  }

  // No `types` here — every condition that leads to JS must carry its own.
  for (const [condition, value] of conditions) {
    walk(value, `${trail} > ${condition}`, packageName, out);
  }
}

// ---------------------------------------------------------------------------
// Package discovery
// ---------------------------------------------------------------------------

export interface PublishablePackage {
  name: string;
  exports: unknown;
}

/**
 * Every publishable package (`private !== true`) under `packages/*` that
 * declares an `exports` map. New packages are covered automatically.
 */
export function getPublishablePackagesWithExports(
  packagesDir: string = PACKAGES_DIR,
): PublishablePackage[] {
  const packages: PublishablePackage[] = [];
  for (const name of fs.readdirSync(packagesDir).sort()) {
    const pkgJsonPath = path.join(packagesDir, name, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkg: { name?: string; private?: boolean; exports?: unknown } =
      JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    if (pkg.private === true || !pkg.exports) continue;
    packages.push({ name: pkg.name ?? name, exports: pkg.exports });
  }
  return packages;
}

export function validateAllPackages(
  packagesDir: string = PACKAGES_DIR,
): Violation[] {
  const violations: Violation[] = [];
  for (const pkg of getPublishablePackagesWithExports(packagesDir)) {
    violations.push(...findExportsTypeViolations(pkg.name, pkg.exports));
  }
  return violations;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const violations = validateAllPackages();

  if (violations.length === 0) {
    console.log(
      "All publishable packages declare a `types` condition for every JS export.",
    );
    process.exit(0);
  }

  console.error(
    `Found ${violations.length} export${violations.length === 1 ? "" : "s"} missing a valid "types" condition (issue #3324):\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.package}  ${v.subpath}\n    ${v.reason}`);
  }
  console.error(
    "\nEvery JS entry in a package.json `exports` map needs a `types` condition.\n" +
      "tsdown-managed packages get it from scripts/tsdown-exports.mjs (withTypesConditions) —\n" +
      "rebuild the package after editing its tsdown config. Hand-maintained maps must add it directly.",
  );
  process.exit(1);
}

// Only run main when executed directly (not when imported for tests).
const isDirectRun = typeof require !== "undefined" && require.main === module;
if (isDirectRun) {
  main();
}
