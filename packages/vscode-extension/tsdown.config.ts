import { defineConfig } from "tsdown";
import { createRequire } from "node:module";
import * as path from "node:path";

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
};

/**
 * Rolldown plugin that resolves bare specifiers using Node's module
 * resolution. Needed because pnpm's strict node_modules doesn't hoist
 * transitive dependencies (e.g., zod from @copilotkit/a2ui-renderer).
 */
function nodeResolveFallback() {
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
      if (source in workspaceSourceAliases) {
        return { id: workspaceSourceAliases[source], external: false };
      }

      try {
        return { id: require.resolve(source), external: false };
      } catch {
        return null;
      }
    },
  };
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

function stubNodeBuiltinsAndCss() {
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
      if (source in HOOK_PREVIEW_STUBBED_DEPS) {
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
        const names = HOOK_PREVIEW_STUBBED_DEPS[spec] ?? [];
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
]);
