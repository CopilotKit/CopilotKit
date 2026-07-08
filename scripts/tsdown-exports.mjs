import { existsSync } from "node:fs";
import path from "node:path";

// Authored as plain ESM (`.mjs`) with a sibling `.d.mts`, NOT `.ts`: each
// package's `tsdown.config.ts` imports this helper, and tsdown loads those
// configs with Node's native ESM loader when `process.features.typescript` is
// on (Node >= 22.18 / 24 in CI). Native ESM does not resolve extensionless or
// `.ts`-mapped relative imports, so a `.ts` helper imported without an
// extension fails in CI with "Cannot find module". A real `.mjs` imported with
// its explicit extension resolves under the native loader, tsdown's bundler
// loader, and `tsc` (via the adjacent `.d.mts`) alike.

/**
 * Ensure every generated `exports` entry carries a `types` condition.
 *
 * tsdown (0.20.x) auto-generates the package.json `exports` map from build
 * output but never writes a `types` condition into it — it only sets the
 * top-level `types` field, which TypeScript ignores under `moduleResolution`
 * `bundler`/`node16`/`nodenext` once an `exports` map is present. Tools that
 * strictly follow the exports map (e.g. the Backstage CLI) then resolve no
 * type declarations and report every named export as "has no exported member"
 * (CopilotKit issue #3324).
 *
 * This post-processes tsdown's generated exports: for each `import`/`require`
 * (or bare string) target pointing at an emitted `.mjs`/`.cjs`/`.js`, it nests
 * a matching `types` condition (`.d.mts`/`.d.cts`/`.d.ts`) FIRST so ESM
 * consumers get ESM-flavored declarations and CJS consumers get CJS-flavored
 * ones (keeping `are-the-types-wrong` green — a single top-level `.d.cts` on an
 * ESM `import` would report as False CJS). Targets without an adjacent
 * declaration file (CSS, `package.json`, UMD) are left untouched.
 *
 * Wire it into `tsdown.config.ts` via the `exports.customExports` hook:
 *   exports: { customExports: (exports, ctx) => withTypesConditions(exports, ctx) }
 */
export function withTypesConditions(exports, ctx) {
  // `packageJsonPath` is present at runtime but absent from tsdown's public
  // `PackageJson` type; fall back to cwd (nx runs each build from the package
  // directory) if it is ever missing.
  const packageJsonPath = ctx.pkg?.packageJsonPath;
  const pkgDir =
    typeof packageJsonPath === "string"
      ? path.dirname(packageJsonPath)
      : process.cwd();
  const result = {};
  for (const [subpath, entry] of Object.entries(exports)) {
    result[subpath] = withTypes(entry, pkgDir);
  }
  return result;
}

function withTypes(entry, pkgDir) {
  if (typeof entry === "string") {
    return typedTarget(entry, pkgDir) ?? entry;
  }
  const next = {};
  for (const [condition, target] of Object.entries(entry)) {
    next[condition] =
      typeof target === "string"
        ? (typedTarget(target, pkgDir) ?? target)
        : withTypes(target, pkgDir);
  }
  return next;
}

/**
 * Map a JS output path to a `{ types, default }` pair when a sibling
 * declaration file exists; return `null` to leave the target unchanged.
 */
function typedTarget(jsPath, pkgDir) {
  const typesPath = jsPath.endsWith(".mjs")
    ? `${jsPath.slice(0, -".mjs".length)}.d.mts`
    : jsPath.endsWith(".cjs")
      ? `${jsPath.slice(0, -".cjs".length)}.d.cts`
      : jsPath.endsWith(".js")
        ? `${jsPath.slice(0, -".js".length)}.d.ts`
        : null;
  if (!typesPath || !existsSync(path.resolve(pkgDir, typesPath))) return null;
  return { types: typesPath, default: jsPath };
}
