import { defineConfig } from "tsdown";

/**
 * Build configuration for `@copilotkit/web-components`.
 *
 * Mirrors the multi-format layout used by `packages/a2ui-renderer`:
 * an unbundled ESM/CJS build (with `.d.ts`) for the root and the
 * `./drawer` subpath, plus a single-file UMD bundle for `<script>`
 * consumers.
 *
 * `lit` handling differs by format on purpose:
 * - ESM/CJS externalize `lit` (it is a peer dependency) so an npm host that
 *   already depends on Lit dedupes a single copy of the runtime.
 * - The UMD bundle INLINES `lit` so the advertised `<script>`/CDN path is
 *   self-contained. Externalizing it there mapped Lit submodules to UMD
 *   globals (`LitDirectivesRepeat`, …) that Lit's CDN build never exposes,
 *   so the very first `repeat()`/`classMap()` call threw at runtime.
 */
export default defineConfig([
  {
    entry: ["src/index.ts", "src/threads-drawer/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    external: (id) => {
      const externalPkgs = ["lit"];
      return externalPkgs.some((pkg) => id === pkg || id.startsWith(pkg + "/"));
    },
    exports: false,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitWebComponents",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    // Force `lit` (a peer dependency, which tsdown would otherwise externalize)
    // to be INLINED into the UMD bundle so the single `<script>`/CDN artifact is
    // self-contained. Externalizing it emitted a bare `require('lit')` that has
    // no meaning in a browser global script. Inlining `lit` necessarily pulls in
    // its runtime deps (`@lit/reactive-element`, `lit-html`, `lit-element`,
    // `@lit-labs/ssr-dom-shim`); that transitive bundling is intentional here, so
    // disable tsdown's "unintended bundling" guard (which is fatal under CI).
    noExternal: [/^lit(\/|$)/, /^@lit\//, "lit-html", "lit-element"],
    inlineOnly: false,
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      return options;
    },
  },
]);
