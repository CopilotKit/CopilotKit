import { defineConfig } from "tsdown";

export default defineConfig([
  {
    // `mount` holds no runtime import of `index`, so adapters can import it
    // eagerly and still load the Inspector itself as a lazy chunk.
    entry: ["src/index.ts", "src/mount.ts"],
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
    globalName: "CopilotKitWebInspector",
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
        "@copilotkit/core": "CopilotKitCore",
        "@copilotkit/shared": "CopilotKitShared",
      };
      return options;
    },
  },
]);
