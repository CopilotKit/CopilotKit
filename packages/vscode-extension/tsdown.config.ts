import { defineConfig } from "tsdown";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as fs from "node:fs";

const require = createRequire(import.meta.url);

// Resolve workspace packages to their TypeScript source instead of compiled
// dist. This avoids CJS-to-ESM interop bugs in Rolldown (e.g., variable
// shadowing in __commonJSMin wrappers that cause TDZ errors).
const workspaceSourceAliases: Record<string, string> = {
  "@copilotkit/a2ui-renderer": path.resolve(
    import.meta.dirname,
    "../a2ui-renderer/src/index.ts",
  ),
  // @copilotkit/shared ships a CJS dist (e.g. utils/clipboard.cjs) that
  // rolldown wraps in __commonJSMin. Those wrappers trigger TDZ errors
  // ("Cannot access 'require_clipboard' before initialization") when the
  // bundle has circular imports through the markdown/chat chain. Resolving
  // to TS source dodges the CJS wrapper entirely.
  "@copilotkit/shared": path.resolve(
    import.meta.dirname,
    "../shared/src/index.ts",
  ),
  // Same __commonJSMin TDZ pattern — dist wraps `graphql` (the npm lib,
  // CJS) and initialisation order breaks under circular imports from
  // react-core's runtime client:
  //   Uncaught ReferenceError: Cannot access 'require_graphql' before initialization
  // TS source uses ESM imports that rolldown handles cleanly.
  "@copilotkit/runtime-client-gql": path.resolve(
    import.meta.dirname,
    "../runtime-client-gql/src/index.ts",
  ),
  // Same CJS/TDZ pattern surfaces in the playground webview once CopilotChat
  // is bundled — @copilotkit/core's dist wraps its src as a __commonJSMin
  // module and rolldown emits `init_src` AFTER callers that need it
  // (shared/package.json region calls `init_errors$1` → `init_src` at line
  // 52687, but `var init_src = __esmMin(...)` isn't assigned until
  // line 107745 → "init_src is not a function"). Aliasing to TS source
  // side-steps the CJS wrapper and rolldown's init-ordering works again.
  "@copilotkit/core": path.resolve(import.meta.dirname, "../core/src/index.ts"),
};

// Source aliases specifically for the playground webview — resolves the
// @copilotkit/react-core/v2 sub-path import to TS source so rolldown can
// tree-shake individual components. The pre-built v2 dist is a monolithic
// chunk; importing from it pulls the full 7MB chat + language-pack surface
// even when only CopilotKitProvider / useFrontendTool are referenced.
const playgroundSourceAliases: Record<string, string> = {
  ...workspaceSourceAliases,
  "@copilotkit/react-core/v2": path.resolve(
    import.meta.dirname,
    "../react-core/src/v2/index.ts",
  ),
};

/**
 * Rolldown plugin that resolves bare specifiers using Node's module
 * resolution. Needed because pnpm's strict node_modules doesn't hoist
 * transitive dependencies (e.g., zod from @copilotkit/a2ui-renderer).
 *
 * @param aliases - optional extra alias map applied before Node resolution.
 *   Defaults to `workspaceSourceAliases`.
 */
function nodeResolveFallback(
  aliases: Record<string, string> = workspaceSourceAliases,
) {
  return {
    name: "node-resolve-fallback",
    enforce: "pre" as const,
    resolveId(source: string) {
      // Skip relative, absolute, node builtins, and vscode
      if (
        source.startsWith(".") ||
        path.isAbsolute(source) ||
        source.startsWith("node:") ||
        source === "vscode"
      ) {
        return null;
      }

      // Resolve workspace packages to TypeScript source
      if (source in aliases) {
        return { id: aliases[source], external: false };
      }

      // Resolve the package, preferring the ESM ("import" condition) entry
      // when the package ships both. `require.resolve()` alone picks the
      // `.cjs` path, which rolldown then wraps with __commonJSMin — that
      // wrapping triggers TDZ bugs for CJS dists that use common patterns
      // like `const foo = require_foo();` where the local `foo` shadows the
      // outer wrapper variable name (see @tanstack/pacer/dist/index.cjs).
      // Prefer ESM to keep rolldown on a clean compile path.
      try {
        const cjsPath = require.resolve(source);
        const esmPath = resolveEsmEntry(source, cjsPath);
        return { id: esmPath ?? cjsPath, external: false };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Given a resolved CJS path (e.g. `/.../dist/index.cjs`) and the original
 * bare specifier, returns the package's ESM entry if `package.json` declares
 * one via `exports["."].import`, `exports.import`, or the legacy `module`
 * field. Returns `null` otherwise (caller falls back to the CJS path).
 */
function resolveEsmEntry(specifier: string, cjsPath: string): string | null {
  try {
    // Walk up from the resolved path to find the package's package.json.
    let dir = path.dirname(cjsPath);
    let pkgJsonPath: string | null = null;
    const root = path.parse(dir).root;
    while (dir !== root) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        pkgJsonPath = candidate;
        break;
      }
      dir = path.dirname(dir);
    }
    if (!pkgJsonPath) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    const pkgDir = path.dirname(pkgJsonPath);

    // Only swap if the specifier matches the package's own name — sub-path
    // imports (e.g. `@tanstack/pacer/async-queuer`) have their own exports
    // entries we don't attempt to walk here.
    if (specifier !== pkg.name) return null;

    // Check exports["."].import first, then exports.import, then `module`.
    const exp = pkg.exports;
    const importPath = exp?.["."]?.import ?? exp?.import ?? pkg.module ?? null;
    if (typeof importPath !== "string") return null;
    const resolved = path.resolve(pkgDir, importPath);
    return fs.existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Rolldown plugin that stubs out Node builtins and CSS imports to empty
 * modules for browser targets that transitively pull them in through a
 * library not originally meant for bundling (e.g. `@copilotkit/react-core`
 * pulls `node-fetch` which loads `crypto`, `stream`, `zlib`, etc.).
 *
 * Only safe when the bundled code's runtime path doesn't actually need those
 * modules — which is the case for hook-preview, because `node-fetch` is
 * replaced by the browser's native `fetch` at runtime and the transitively
 * imported CSS is harmless ambient styling that we don't want injected into
 * the webview.
 */
const NODE_BUILTINS = new Set([
  "crypto",
  "stream",
  "string_decoder",
  "zlib",
  "http",
  "https",
  "http2",
  "fs",
  "path",
  "url",
  "util",
  "os",
  "buffer",
  "querystring",
  "net",
  "tls",
  "events",
  "assert",
  "child_process",
  "dns",
  "dgram",
  "worker_threads",
]);

// Transitive markdown-rendering chain pulled in by @copilotkit/react-core's
// chat components. Unreachable on the hook-preview runtime path (we render
// user JSX directly, not markdown messages). Stubbing avoids JSON→ESM named-
// import interop failures and trims the bundle.
//
// Each entry lists the named exports the dependents statically import — we
// emit a module exposing exactly those names as `undefined` so rolldown's
// named-export analysis succeeds. If more markdown deps break the build as
// the tree grows, add entries here.
const HOOK_PREVIEW_STUBBED_DEPS: Record<string, string[]> = {
  "stringify-entities": ["stringifyEntities"],
  "character-entities-legacy": ["characterEntitiesLegacy"],
  "character-entities": ["characterEntities"],
  "character-reference-invalid": ["characterReferenceInvalid"],
  "parse-entities": ["parseEntities"],
};

// Additional stubs for the playground webview that imports
// @copilotkit/react-core/v2. The v2 chat UI pulls in `streamdown` (a syntax-
// highlighting renderer with ~6MB of language grammar chunks) and `katex`
// (math rendering). Neither is needed by the playground shell — the shell
// only needs CopilotKitProvider to connect to the runtime; actual chat
// message rendering never runs in this context.
//
// Stubbing these packages keeps playground.js near the same ~1MB range as
// hook-preview.js. If the playground ever gains a real chat panel (Plan #4),
// remove the stubs and accept the larger bundle instead.
const PLAYGROUND_EXTRA_STUBBED_DEPS: Record<string, string[]> = {
  streamdown: ["Streamdown"],
  katex: ["default"],
  "katex/dist/katex.min.css": [],
};

// Browser-compatible shim for Node's `crypto`. Most transitive users we hit
// (e.g. the `uuid` npm package via react-core's ThreadsProvider) call
// `randomFillSync(buf)` or `randomUUID()`. The webview has WebCrypto on
// `globalThis.crypto`; we forward the handful of APIs the Node version
// exposes that actually get called at module-init / first-render time.
// If more APIs get exercised, extend this shim rather than going back to
// an empty-module stub.
const CRYPTO_SHIM_SOURCE = `
const webCrypto = globalThis.crypto;
export function randomFillSync(buf) {
  webCrypto.getRandomValues(buf);
  return buf;
}
export function randomBytes(size) {
  const buf = new Uint8Array(size);
  webCrypto.getRandomValues(buf);
  return buf;
}
export function randomUUID() {
  return webCrypto.randomUUID();
}
const shim = { randomFillSync, randomBytes, randomUUID };
export default shim;
`;

/**
 * Rolldown plugin that copies a CSS source file to the output directory as a
 * standalone asset (not bundled into JS). Used to emit playground.css from
 * chat-tab.css so view-provider.ts can reference it via webview.asWebviewUri.
 *
 * The stubNodeBuiltinsAndCss plugin stubs `.css` imports to empty modules
 * inside the bundle, but we still want the CSS file itself to land in dist/.
 * This plugin emits the file via `this.emitFile` in `buildStart`, which is
 * the rolldown-compatible way to add assets to the output.
 */
function copyCssAsset(srcPath: string, destName: string) {
  return {
    name: "copy-css-asset",
    buildStart() {
      const css = fs.readFileSync(srcPath, "utf-8");
      (this as { emitFile: (opts: unknown) => void }).emitFile({
        type: "asset",
        fileName: destName,
        source: css,
      });
    },
  };
}

function stubNodeBuiltinsAndCss(extraStubs: Record<string, string[]> = {}) {
  const allStubs = { ...HOOK_PREVIEW_STUBBED_DEPS, ...extraStubs };
  const EMPTY_MODULE_ID = "\0empty-module";
  const CRYPTO_SHIM_ID = "\0copilotkit-crypto-shim";
  const STUB_PREFIX = "\0stub:";
  return {
    name: "stub-node-builtins-and-css",
    enforce: "pre" as const,
    resolveId(source: string) {
      if (source.endsWith(".css")) return EMPTY_MODULE_ID;
      const bare = source.startsWith("node:") ? source.slice(5) : source;
      if (bare === "crypto") return CRYPTO_SHIM_ID;
      if (NODE_BUILTINS.has(bare)) return EMPTY_MODULE_ID;
      if (source in allStubs) {
        return STUB_PREFIX + source;
      }
      return null;
    },
    load(id: string) {
      if (id === EMPTY_MODULE_ID) {
        return "export default {};";
      }
      if (id === CRYPTO_SHIM_ID) {
        return CRYPTO_SHIM_SOURCE;
      }
      if (id.startsWith(STUB_PREFIX)) {
        const spec = id.slice(STUB_PREFIX.length);
        const names = allStubs[spec] ?? [];
        const lines = names.map((n) => `export const ${n} = undefined;`);
        lines.push("export default {};");
        return lines.join("\n");
      }
      return null;
    },
  };
}

export default defineConfig([
  // Extension host — Node.js, CJS (what VS Code loads)
  {
    entry: ["src/extension/activate.ts"],
    format: ["cjs"],
    platform: "node",
    outDir: "dist/extension",
    external: ["vscode", /^node:/],
    sourcemap: true,
    plugins: [nodeResolveFallback()],
  },
  // Webview app — browser, ESM (loaded via <script type="module">)
  // ESM format is required because @copilotkit/a2ui-renderer has circular
  // dependencies that break in IIFE/CJS format. ESM handles them via live bindings.
  {
    entry: ["src/webview/index.tsx"],
    format: ["esm"],
    platform: "browser",
    outDir: "dist/webview",
    sourcemap: true,
    external: [],
    noExternal: [/.*/],
    plugins: [nodeResolveFallback()],
  },
  // Inspector webview — browser, ESM
  {
    entry: { inspector: "src/webview/inspector/index.tsx" },
    outDir: "dist/webview",
    format: ["esm"],
    platform: "browser",
    noExternal: [/.*/],
    dts: false,
    clean: false,
    plugins: [nodeResolveFallback()],
  },
  // Hook list sidebar webview — browser, ESM.
  // Doesn't import @copilotkit/react-core, so no node-builtin/CSS stubbing
  // is needed (unlike hook-preview).
  {
    entry: { "hook-list": "src/webview/hook-list/index.tsx" },
    outDir: "dist/webview",
    format: ["esm"],
    platform: "browser",
    noExternal: [/.*/],
    dts: false,
    clean: false,
    plugins: [nodeResolveFallback()],
  },
  // Hook-preview webview — browser, ESM.
  // Transitively imports `@copilotkit/react-core`, which pulls in node-fetch
  // (which loads Node builtins) and ambient CSS. Neither is needed at runtime
  // in the webview; `stubNodeBuiltinsAndCss` resolves them to empty modules.
  {
    entry: { "hook-preview": "src/webview/hook-preview/index.tsx" },
    outDir: "dist/webview",
    format: ["esm"],
    platform: "browser",
    noExternal: [/.*/],
    dts: false,
    clean: false,
    plugins: [stubNodeBuiltinsAndCss(), nodeResolveFallback()],
  },
  // Catalog-list sidebar webview — browser, ESM.
  // Same lightweight profile as hook-list: no react-core dep, so no stubbing.
  {
    entry: { "catalog-list": "src/webview/catalog-list/index.tsx" },
    outDir: "dist/webview",
    format: ["esm"],
    platform: "browser",
    noExternal: [/.*/],
    dts: false,
    clean: false,
    plugins: [nodeResolveFallback()],
  },
  // Playground (chat tab) webview — browser, ESM.
  // Imports @copilotkit/react-core/v2 (via forwarding-stubs) for real
  // CopilotKitProvider / useFrontendTool. We resolve v2 to its TS source
  // (playgroundSourceAliases) so rolldown can tree-shake individual
  // components rather than bundling the monolithic pre-built chunk.
  // The same stubNodeBuiltinsAndCss() plugin as hook-preview keeps the
  // bundle browser-safe (no Node builtins or CSS bundling errors).
  {
    entry: { playground: "src/webview/playground/index.tsx" },
    outDir: "dist/webview",
    // IIFE (not ESM) to avoid two issues:
    // 1) The VSCode webview loads playground.js via a classic <script> tag
    //    which can't parse top-level ES `import` statements.
    // 2) ESM output with `inlineDynamicImports: true` exposed a module-init
    //    ordering bug — rolldown's `__esmMin` lazy-init wrappers emit their
    //    `var init_X = __esmMin(...)` declarations in an order that breaks
    //    TDZ guarantees when everything is inlined (init_src was used on
    //    line 52686 but declared on line 107745 → "init_src is not a
    //    function"). IIFE wraps everything in a single function scope with
    //    eager evaluation in dependency order, sidestepping the hoisting
    //    quirks.
    format: ["iife"],
    globalName: "__copilotkit_playground_bundle",
    platform: "browser",
    noExternal: [/.*/],
    dts: false,
    clean: false,
    outputOptions: {
      inlineDynamicImports: true,
      // Override tsdown's default `playground.iife.js` name so view-provider's
      // HTML continues to load `playground.js` like all the other webviews.
      entryFileNames: "[name].js",
    },
    plugins: [
      stubNodeBuiltinsAndCss(PLAYGROUND_EXTRA_STUBBED_DEPS),
      nodeResolveFallback(playgroundSourceAliases),
      copyCssAsset(
        path.resolve(
          import.meta.dirname,
          "src/webview/playground/chat-tab.css",
        ),
        "playground.css",
      ),
    ],
  },
]);
