import { defineConfig } from "tsdown";

// `semver` only ships CommonJS, which makes Angular's esbuild warn about
// optimization bailouts (#7654). Bundle it so consumers get ESM, and keep it
// out of the published `dependencies`.
const bundled = ["semver"];

export default defineConfig([
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
    noExternal: bundled,
    inlineOnly: bundled,
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
