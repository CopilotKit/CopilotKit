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
 *
 * Mirror of `ExportsEntry` in `scripts/tsdown-exports.d.mts`; the two are
 * hand-kept in sync (a `.ts` script and a `.d.mts` declaration cannot share
 * one source without coupling the validator to the build helper).
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

// import- and require-mode resolve types INDEPENDENTLY. In each mode TypeScript
// matches the first condition present (in object order) from
// {types, <mode>, node, default} — so `import` and `require` never shadow each
// other, and a trailing `default`/`node` after both is unreachable in every
// mode. Runtime-only conditions (browser/deno/worker/development/production/…)
// are ignored for types, so a JS target under one needs no declaration.
const RESOLUTION_MODES = ["import", "require"] as const;

function isActiveCondition(
  condition: string,
  mode: (typeof RESOLUTION_MODES)[number],
): boolean {
  return (
    condition === "types" ||
    condition === mode ||
    condition === "node" ||
    condition === "default"
  );
}

/**
 * Whether a condition's value resolves to SOMETHING for `mode`. A string always
 * resolves; an object resolves only if it has a branch active for that mode
 * (recursively). A partial object (e.g. only `import`) does NOT resolve for
 * `require`, so a strict resolver falls through to the next sibling condition —
 * which is where an untyped JS target can hide. Applies to every condition,
 * not just `types` (a partial `node`/`default`/`import` object falls through
 * the same way).
 */
function resolvesForMode(
  value: ExportsEntry,
  mode: (typeof RESOLUTION_MODES)[number],
): boolean {
  if (typeof value === "string") return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => resolvesForMode(item, mode));
  }
  return Object.entries(value).some(
    ([condition, sub]) =>
      isActiveCondition(condition, mode) && resolvesForMode(sub, mode),
  );
}

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

/**
 * Return every entry in one package's `exports` map where TypeScript's import-
 * or require-mode resolution lands on runtime JavaScript instead of a
 * declaration file — i.e. TypeScript (and strict `exports` resolvers such as
 * the Backstage CLI) would find no `.d.ts` for that subpath.
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
 * string (`"exports": "./index.mjs"`), a top-level fallback array, and a
 * conditions-only object (`{ import, require }` with no `.`/`./…` keys) are all
 * sugar for the `.` subpath; a real subpath map is returned unchanged.
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

  const conditions = Object.entries(entry);

  // 1. Every `types` target must be a declaration file (or, if nested, resolve
  //    to declarations).
  for (const [condition, value] of conditions) {
    if (condition !== "types") continue;
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
  }

  // 2. For each resolution mode the first RESOLVING condition wins. A condition
  //    only wins if it is active for the mode AND its value actually resolves
  //    for that mode (a partial object — `types`, `node`, `default`, … that
  //    lacks the mode's branch — does not, so resolution falls through to the
  //    next sibling, which is where an untyped JS target hides). When the winner
  //    is a JS-returning condition its value must itself carry types. Dedupe so
  //    a shared winner (e.g. a trailing `default`) is reported once; a `types`
  //    winner is covered by step 1.
  const walked = new Set<string>();
  for (const mode of RESOLUTION_MODES) {
    const winner = conditions.find(([condition, value]) =>
      condition === "types"
        ? resolvesForMode(value, mode)
        : isActiveCondition(condition, mode) && resolvesForMode(value, mode),
    );
    if (!winner || winner[0] === "types" || walked.has(winner[0])) continue;
    walked.add(winner[0]);
    walk(winner[1], `${trail} > ${winner[0]}`, packageName, out);
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
    let pkg: { name?: string; private?: boolean; exports?: unknown };
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    } catch (error) {
      throw new Error(`Failed to read or parse ${pkgJsonPath}`, {
        cause: error,
      });
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
