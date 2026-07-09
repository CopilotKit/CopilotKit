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
 * This post-processes tsdown's generated exports (a `subpath -> target` map):
 * for each condition target (typically `import`/`require`) — and bare-string
 * targets — pointing at an emitted `.mjs`/`.cjs`/`.js`, it nests a matching
 * `types` condition (`.d.mts`/`.d.cts`/`.d.ts`) FIRST so ESM consumers get
 * ESM-flavored declarations and CJS consumers get CJS-flavored ones (keeping
 * `are-the-types-wrong` green — a single top-level `.d.cts` on an ESM `import`
 * would report as False CJS). Non-JS targets (`.css`, `package.json`) are left
 * untouched, as is any JS target with no adjacent declaration on disk (which
 * the helper warns about). It only ADDS a missing `types`; it does not split
 * an existing shared `types` into per-flavor declarations (attw guards that).
 *
 * Wire it into `tsdown.config.ts` via the `exports.customExports` hook:
 *   exports: { customExports: (exports, ctx) => withTypesConditions(exports, ctx) }
 */
export function withTypesConditions(exports, ctx) {
  // tsdown always supplies `packageJsonPath` at runtime (it is merely absent
  // from tsdown's public `PackageJson` type). Fail loud rather than silently
  // resolving against the wrong directory and emitting a types-less map — that
  // would reintroduce exactly the #3324 bug this helper prevents.
  const packageJsonPath = ctx?.pkg?.packageJsonPath;
  if (typeof packageJsonPath !== "string") {
    throw new Error(
      "withTypesConditions: ctx.pkg.packageJsonPath is required to resolve declaration files",
    );
  }
  // tsdown always hands us a `subpath -> target` object; guard so a bare-string
  // or array `exports` fails loud instead of being iterated character-/index-
  // wise into a corrupt map.
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) {
    throw new Error(
      "withTypesConditions: expected a subpath -> target `exports` object",
    );
  }
  const pkgDir = path.dirname(packageJsonPath);
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
  // `null` blocks a subpath; leave it (and any non-object) untouched.
  if (entry === null || typeof entry !== "object") return entry;
  // Fallback arrays (`"import": ["./a.mjs", "./b.mjs"]`) are legal: transform
  // each element and keep the array rather than corrupting it into an object.
  if (Array.isArray(entry)) return entry.map((item) => withTypes(item, pkgDir));
  // Idempotent: skip only this helper's OWN output shape — a `{ types: <string>,
  // default, ... }` object (a string `types` listed first). Keying this
  // narrowly (not "any first `types`") means a hand-authored `types`-last OR
  // `types`-first-but-partial-object entry is still normalized (so its untyped
  // siblings get a `types` condition) instead of passed through, keeping the
  // helper's output consistent with what the validator accepts.
  if (Object.keys(entry)[0] === "types" && typeof entry.types === "string") {
    return entry;
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
 * declaration file exists. Returns `null` (caller leaves the target as-is) for
 * a non-JS target, or — with a loud warning — for a JS target whose declaration
 * is missing, since emitting it untyped reintroduces #3324 for that subpath.
 */
function typedTarget(jsPath, pkgDir) {
  const typesPath = jsPath.endsWith(".mjs")
    ? `${jsPath.slice(0, -".mjs".length)}.d.mts`
    : jsPath.endsWith(".cjs")
      ? `${jsPath.slice(0, -".cjs".length)}.d.cts`
      : jsPath.endsWith(".js")
        ? `${jsPath.slice(0, -".js".length)}.d.ts`
        : null;
  if (!typesPath) return null; // non-JS (css/json): genuinely untyped, no warning
  if (!existsSync(path.resolve(pkgDir, typesPath))) {
    console.warn(
      `[tsdown-exports] "${jsPath}" has no adjacent declaration (${typesPath}); ` +
        `leaving it without a types condition (reintroduces #3324 for this subpath).`,
    );
    return null;
  }
  return { types: typesPath, default: jsPath };
}
