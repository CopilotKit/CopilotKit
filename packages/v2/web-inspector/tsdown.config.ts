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
    loader: {
      ".css": "text",
      ".svg": "dataurl",
    },
    exports: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitNextWebInspector",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: ["lit", "lit/decorators.js"],
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
        "@copilotkitnext/core": "CopilotKitNextCore",
      };
      return options;
    },
  },
]);
