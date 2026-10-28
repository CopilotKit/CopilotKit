import { defineConfig } from "tsdown";

// `semver` only ships CommonJS, which makes Angular's esbuild warn about
// optimization bailouts (#7654). Bundle it so consumers get ESM, and keep it
// out of the published `dependencies`.
const bundled = ["semver"];

// semver's files require each other in a cycle (`classes/comparator` <->
// `classes/range`), so it can't go through `unbundle`, which emits each file
// as its own ES module. `src/lib/semver.ts` is built on its own as one bundled
// module, and the unbundled build imports it as an external.
const semverWrapper = "@copilotkit/web-inspector/lib/semver";
const externalSemverWrapper = {
  name: "external-semver-wrapper",
  resolveId(source: string, importer: string | undefined) {
    if (
      source === "./semver.js" &&
      importer &&
      /[\\/]src[\\/]lib[\\/]/.test(importer)
    ) {
      return { id: semverWrapper, external: true };
    }
  },
};

export default defineConfig([
  {
    entry: { "lib/semver": "src/lib/semver.ts" },
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    noExternal: bundled,
    inlineOnly: bundled,
  },
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    loader: {
      ".css": "text",
      ".svg": "dataurl",
    },
    exports: true,
    plugins: [externalSemverWrapper],
    outputOptions(options, format) {
      const ext = format === "es" ? "mjs" : "cjs";
      options.paths = (id) => (id === semverWrapper ? `./semver.${ext}` : id);
      return options;
    },
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitWebInspector",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: ["lit", "lit/decorators.js"],
    noExternal: bundled,
    inlineOnly: bundled,
    loader: {
      ".css": "text",
      ".svg": "dataurl",
    },
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        lit: "Lit",
        "lit/decorators.js": "LitDecorators",
        "lit/directives/style-map.js": "LitDirectivesStyleMap",
        "lit/directives/unsafe-html.js": "LitDirectivesUnsafeHtml",
        marked: "marked",
        lucide: "lucide",
        "@copilotkit/core": "CopilotKitCore",
        "@copilotkit/shared": "CopilotKitShared",
      };
      return options;
    },
  },
]);
