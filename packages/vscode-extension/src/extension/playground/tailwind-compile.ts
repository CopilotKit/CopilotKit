import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Result of trying to compile Tailwind for the user's playground bundle.
 *
 * - `css`: the generated stylesheet, when compilation succeeded.
 * - `entryCss`: the user's CSS file we used as the entry (absolute path).
 *   Surfaced to the Diagnostics panel so the user knows what we picked up.
 * - `error`: when present, indicates compilation was attempted but failed
 *   (e.g. their CSS has a `@plugin` we couldn't resolve). Logged to the
 *   output channel; not surfaced as a fatal bundle error.
 * - `skipped`: when present, no Tailwind setup was detected — the playground
 *   renders without per-app utility CSS. Reason text goes to Diagnostics.
 */
export interface TailwindCompileResult {
  css?: string;
  entryCss?: string;
  error?: string;
  skipped?: string;
}

/**
 * Common locations a Next/Vite/CRA app keeps its global CSS. Checked in
 * order; first hit that contains a Tailwind directive wins.
 */
const COMMON_CSS_PATHS = [
  "src/app/globals.css",
  "src/app/global.css",
  "app/globals.css",
  "app/global.css",
  "src/styles/globals.css",
  "src/styles/global.css",
  "styles/globals.css",
  "styles/global.css",
  "src/index.css",
  "src/main.css",
];

const TAILWIND_DIRECTIVE_RE =
  /@import\s+["']tailwindcss["']|@tailwind\s+(base|components|utilities)/;

/**
 * Returns the absolute path to a CSS file that contains a Tailwind
 * directive (`@import "tailwindcss"` for v4 or `@tailwind base|...` for v3).
 *
 * Resolution order:
 *   1. `override` (explicit path from the
 *      `copilotkit.playground.tailwindEntryCss` setting)
 *   2. The common Next/Vite/CRA locations in `COMMON_CSS_PATHS`
 *
 * Returns null if no entry was found. We deliberately do not walk the
 * whole tree — large projects can have hundreds of `.css` files; the
 * setting is the escape hatch for non-standard layouts.
 */
export function detectTailwindEntryCss(
  workspaceRoot: string,
  override?: string,
): string | null {
  if (override) {
    const abs = path.isAbsolute(override)
      ? override
      : path.join(workspaceRoot, override);
    if (fs.existsSync(abs)) return abs;
    return null;
  }
  for (const rel of COMMON_CSS_PATHS) {
    const abs = path.join(workspaceRoot, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const contents = fs.readFileSync(abs, "utf-8");
      if (TAILWIND_DIRECTIVE_RE.test(contents)) return abs;
    } catch {
      /* unreadable file — keep searching */
    }
  }
  return null;
}

interface TailwindCompileOptions {
  workspaceRoot: string;
  bundledJs: string;
  /** Explicit CSS entry override (`copilotkit.playground.tailwindEntryCss`). */
  entryCssOverride?: string;
  log: (line: string) => void;
}

/**
 * Compiles a Tailwind v4 stylesheet against the playground's bundled JS.
 *
 * Strategy:
 *   1. Find the user's CSS entry (or skip if none).
 *   2. Load `@tailwindcss/node`'s `compile()` API. We try the user's project
 *      first so their installed plugins / theme imports resolve, then fall
 *      back to the extension's own copy.
 *   3. Use `@tailwindcss/oxide`'s Scanner to extract candidate class names
 *      from the bundled JS. The bundle is the source of truth — every class
 *      string the playground will ever render is in there post-bundling.
 *   4. Call `compiled.build(candidates)` and return the CSS.
 *
 * Failures are non-fatal: the playground still loads, just without the
 * user's utility CSS. Reasons are logged + returned for the Diagnostics
 * panel.
 */
export async function compileTailwindForBundle(
  opts: TailwindCompileOptions,
): Promise<TailwindCompileResult> {
  const entryCss = detectTailwindEntryCss(
    opts.workspaceRoot,
    opts.entryCssOverride,
  );
  if (!entryCss) {
    const reason = opts.entryCssOverride
      ? `tailwind: entry CSS override does not exist: ${opts.entryCssOverride}`
      : "tailwind: no entry CSS detected in workspace (looked at src/app/globals.css, src/index.css, etc.)";
    opts.log(`[playground-tailwind] ${reason}`);
    return { skipped: reason };
  }
  opts.log(`[playground-tailwind] entry CSS: ${entryCss}`);

  let tailwindNode: typeof import("@tailwindcss/node");
  let oxide: typeof import("@tailwindcss/oxide");
  try {
    [tailwindNode, oxide] = await Promise.all([
      loadTailwindNode(opts.workspaceRoot, opts.log),
      loadOxide(opts.workspaceRoot, opts.log),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.log(`[playground-tailwind] load failed: ${message}`);
    return { entryCss, error: message };
  }

  try {
    const cssSource = fs.readFileSync(entryCss, "utf-8");
    const compiled = await tailwindNode.compile(cssSource, {
      base: path.dirname(entryCss),
      from: entryCss,
      onDependency: () => {
        /* dependency tracking unused — we don't watch */
      },
      customCssResolver: createCssResolver(opts.workspaceRoot),
      customJsResolver: createJsResolver(opts.workspaceRoot),
    });

    const scanner = new oxide.Scanner({ sources: [] });
    const candidates = scanner.scanFiles([
      { content: opts.bundledJs, extension: "js" },
    ]);
    opts.log(
      `[playground-tailwind] candidates=${candidates.length} (from bundle)`,
    );

    const css = compiled.build(candidates);
    return { css, entryCss };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.log(`[playground-tailwind] compile failed: ${message}`);
    return { entryCss, error: message };
  }
}

/**
 * Resolves `@tailwindcss/node` from the user's project first (so their
 * version + plugin tree are honored), then from the extension's own
 * node_modules. Throws if neither resolves.
 */
async function loadTailwindNode(
  workspaceRoot: string,
  log: (line: string) => void,
): Promise<typeof import("@tailwindcss/node")> {
  const userMod = await tryLoadFrom<typeof import("@tailwindcss/node")>(
    "@tailwindcss/node",
    workspaceRoot,
  );
  if (userMod) {
    log(`[playground-tailwind] using user's @tailwindcss/node`);
    return userMod;
  }
  log(`[playground-tailwind] using extension's @tailwindcss/node`);
  return import("@tailwindcss/node");
}

async function loadOxide(
  workspaceRoot: string,
  log: (line: string) => void,
): Promise<typeof import("@tailwindcss/oxide")> {
  const userMod = await tryLoadFrom<typeof import("@tailwindcss/oxide")>(
    "@tailwindcss/oxide",
    workspaceRoot,
  );
  if (userMod) {
    log(`[playground-tailwind] using user's @tailwindcss/oxide`);
    return userMod;
  }
  log(`[playground-tailwind] using extension's @tailwindcss/oxide`);
  return import("@tailwindcss/oxide");
}

/**
 * Attempts to import a module resolved from `from`. Returns the module on
 * success, null if resolution failed (the package isn't installed in the
 * user's tree). Errors during the import itself propagate — those indicate
 * a real bug, not a missing install.
 */
async function tryLoadFrom<T>(
  specifier: string,
  from: string,
): Promise<T | null> {
  const { createRequire } = await import("node:module");
  let resolved: string;
  try {
    const userRequire = createRequire(path.join(from, "package.json"));
    resolved = userRequire.resolve(specifier);
  } catch {
    return null;
  }
  const url = new URL(`file://${resolved.replace(/\\/g, "/")}`);
  return (await import(url.href)) as T;
}

/**
 * Resolves an `@import "<spec>"` from the user's CSS. Tries the user's
 * project first, then the extension's own node_modules so things like
 * `@import "tailwindcss"` succeed even when the user's CSS file lives
 * outside their `node_modules` reach (e.g. test workspaces, monorepo
 * subprojects). Returns `false` to let Tailwind fall through to its
 * default resolver, which handles relative paths.
 *
 * For CSS imports we honor the package's `"style"` export condition (or
 * top-level `"style"` field) — `tailwindcss` ships its main stylesheet at
 * `./index.css` via that condition and `require.resolve` would otherwise
 * pick the JS `"main"` entry, which Tailwind would then choke on.
 */
function createCssResolver(
  workspaceRoot: string,
): (id: string, base: string) => Promise<string | false | undefined> {
  return async (id, base) => {
    if (id.startsWith(".") || id.startsWith("/")) return false;
    return resolveBareSpecifierForCss(id, base, workspaceRoot);
  };
}

/**
 * Same idea as `createCssResolver` but for `@plugin "<pkg>"` / JS-side
 * resolution. Plugins can live anywhere on the resolution chain — user
 * project takes priority because that's where their custom plugins live.
 */
function createJsResolver(
  workspaceRoot: string,
): (id: string, base: string) => Promise<string | false | undefined> {
  return async (id, base) => {
    if (id.startsWith(".") || id.startsWith("/")) return false;
    return resolveBareSpecifier(id, base, workspaceRoot);
  };
}

/**
 * Tries Node-style resolution for `id`, first from the importer's directory
 * (`base`), then from the user's workspace root, then from the extension's
 * own dependencies. Returns the resolved absolute path or undefined. The
 * three-tier walk means a user CSS file that imports `tailwindcss` still
 * works when their entry sits outside a node_modules tree but the
 * extension has its own copy installed.
 */
function resolveBareSpecifier(
  id: string,
  base: string,
  workspaceRoot: string,
): string | undefined {
  const { createRequire } =
    require("node:module") as typeof import("node:module");
  const candidates = [
    path.join(base, "package.json"),
    path.join(workspaceRoot, "package.json"),
    __filename,
  ];
  for (const from of candidates) {
    try {
      return createRequire(from).resolve(id);
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/**
 * CSS-aware variant of `resolveBareSpecifier`: walks the same fallback
 * chain but, once a package is located, returns the file the package's
 * `"style"` export condition (or top-level `"style"` field) points to.
 *
 * `tailwindcss` itself ships its main stylesheet at `./index.css` via
 * `exports["."].style`. Plain `require.resolve` would happily return the
 * JS entry, which Tailwind's CSS parser would then reject with
 * `Invalid declaration: "use strict"`.
 *
 * For sub-path imports (e.g. `tailwindcss/preflight`) we fall back to
 * the regular resolver — those are usually `.css` files at well-known
 * paths and `require.resolve` finds them directly.
 */
function resolveBareSpecifierForCss(
  id: string,
  base: string,
  workspaceRoot: string,
): string | undefined {
  const { createRequire } =
    require("node:module") as typeof import("node:module");
  // The extension lists `@tailwindcss/node` as a direct dep; that package
  // in turn depends on `tailwindcss`. When the user's project has no
  // tailwind config of its own (e.g. the test-workspace), neither
  // `base` nor `workspaceRoot` can resolve `tailwindcss` — but the
  // extension's `@tailwindcss/node` install always can. We use that as
  // a last-ditch resolution origin so detection works for any workspace.
  let tailwindNodeOrigin: string | undefined;
  try {
    tailwindNodeOrigin = require.resolve("@tailwindcss/node/package.json");
  } catch {
    /* extension install incomplete — fall through with what we have */
  }
  const candidates = [
    path.join(base, "package.json"),
    path.join(workspaceRoot, "package.json"),
    __filename,
    ...(tailwindNodeOrigin ? [tailwindNodeOrigin] : []),
  ];
  for (const from of candidates) {
    try {
      const userRequire = createRequire(from);
      // Resolve the package.json for the requested specifier; this gives
      // us the package root we can probe for a `"style"` entry.
      const pkgPath = userRequire.resolve(`${id}/package.json`);
      const pkgDir = path.dirname(pkgPath);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const style =
        pkg.exports?.["."]?.style ?? pkg.exports?.style ?? pkg.style ?? null;
      if (typeof style === "string") {
        return path.resolve(pkgDir, style);
      }
      // Sub-path or no-style package — let Node's resolver pick the file.
      return userRequire.resolve(id);
    } catch {
      /* try next */
    }
  }
  return undefined;
}
