import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    // Keep the overlay CSS as a raw string, same as tsdown 0.20 `loader: text`.
    // Do not lower or minify it. Lightning CSS would change vendor prefixes.
    css: {
      // postcss + no plugins leaves the file unchanged. The lightningcss
      // transformer always rebundles overlay CSS and changes vendor prefixes.
      transformer: "postcss",
      target: false,
      minify: false,
    },
    loader: {
      ".svg": "dataurl",
    },
    exports: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitWebInspector",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: ["lit", "lit/decorators.js"],
    css: {
      transformer: "postcss",
      target: false,
      minify: false,
    },
    loader: {
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
