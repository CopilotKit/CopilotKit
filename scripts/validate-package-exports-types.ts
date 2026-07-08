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

/**
 * A value in a package.json `exports` map: a target path, `null` (blocks a
 * subpath), a fallback array, or a nested conditions object.
 */
export type ExportsEntry =
  | string
  | null
  | ExportsEntry[]
  | { [condition: string]: ExportsEntry };

export interface Violation {
  package: string;
  /** Subpath plus the condition trail, e.g. `". > import"`. */
  subpath: string;
  reason: string;
}

const PACKAGES_DIR = path.resolve(__dirname, "../packages");

const JS_TARGET = /\.(mjs|cjs|js)$/;
const DECLARATION_TARGET = /\.d\.(mts|cts|ts)$/;

// The JS-returning conditions TypeScript resolves types through. Conditions
// match in object order (first match wins), so a `types` condition must appear
// BEFORE these or a strict resolver reaches the JS target first and finds no
// declarations. Runtime-only conditions (browser/deno/worker/development/
// production/…) are absent on purpose: TypeScript ignores them for types, so a
// JS target under one needs no declaration.
const JS_CONDITIONS = new Set(["import", "require", "node", "default"]);

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

/**
 * Return every entry in one package's `exports` map whose first type-relevant
 * condition resolves to runtime JavaScript instead of a declaration file —
 * i.e. TypeScript (and strict `exports` resolvers such as the Backstage CLI)
 * would find no `.d.ts` for that subpath.
 */
export function findExportsTypeViolations(
  packageName: string,
  exportsMap: unknown,
): Violation[] {
  const violations: Violation[] = [];
  for (const [subpath, entry] of Object.entries(normalizeExports(exportsMap))) {
    walk(entry, subpath, packageName, violations);
  }
  return violations;
}

/**
 * Normalize Node's `exports` sugar into a `subpath -> target` map. A bare
 * string (`"exports": "./index.mjs"`) and a conditions-only object
 * (`{ import, require }` with no `.`/`./…` keys) are both sugar for the `.`
 * subpath; a real subpath map is returned unchanged.
 */
function normalizeExports(exportsMap: unknown): Record<string, ExportsEntry> {
  if (typeof exportsMap === "string" || Array.isArray(exportsMap)) {
    return { ".": exportsMap as ExportsEntry };
  }
  if (!exportsMap || typeof exportsMap !== "object") return {};
  const entries = exportsMap as Record<string, ExportsEntry>;
  const isSubpathMap = Object.keys(entries).some(
    (key) => key === "." || key.startsWith("./"),
  );
  return isSubpathMap ? entries : { ".": entries };
}

function walk(
  entry: ExportsEntry,
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
  // `null` blocks a subpath; primitives are not resolvable targets.
  if (!entry || typeof entry !== "object") return;

  // Fallback array: TypeScript resolves the first entry that exists, so every
  // candidate must itself be typed.
  if (Array.isArray(entry)) {
    entry.forEach((item, i) => walk(item, `${trail}[${i}]`, packageName, out));
    return;
  }

  // Conditions match in object order (first match wins), and import- and
  // require-mode resolve independently. Validate each `types` target, and flag
  // every JS-returning condition that is NOT preceded by a `types` (a strict
  // resolver reaches that JS target before any later `types`). Runtime-only
  // conditions are ignored — TypeScript resolves no types through them.
  const conditions = Object.entries(entry);
  const typesIndex = conditions.findIndex(
    ([condition]) => condition === "types",
  );
  conditions.forEach(([condition, value], index) => {
    if (condition === "types") {
      if (typeof value === "string") {
        if (!DECLARATION_TARGET.test(value)) {
          out.push({
            package: packageName,
            subpath: `${trail} > types`,
            reason: `"types" target "${value}" is not a declaration file`,
          });
        }
      } else {
        // Nested/object `types` — recurse so each resolved leaf is validated.
        walk(value, `${trail} > types`, packageName, out);
      }
      return;
    }
    if (!JS_CONDITIONS.has(condition)) return; // runtime-only → no types needed
    // A `types` condition earlier in object order covers this JS condition for
    // its resolution mode.
    if (typesIndex !== -1 && typesIndex < index) return;
    // Otherwise the JS target must itself carry types (a nested `types`) or be
    // a declaration file.
    walk(value, `${trail} > ${condition}`, packageName, out);
  });
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
    let pkg: { name?: string; private?: boolean; exports?: unknown };
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    } catch (error) {
      throw new Error(`Failed to parse ${pkgJsonPath}`, { cause: error });
    }
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
