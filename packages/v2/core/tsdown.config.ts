import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitNextCore",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: [
      "@copilotkitnext/shared",
      "@ag-ui/client",
      "@ag-ui/core",
      "rxjs",
      "zod",
    ],
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        "@copilotkitnext/shared": "CopilotKitNextShared",
        "@ag-ui/client": "AgUIClient",
        "@ag-ui/core": "AgUICore",
        rxjs: "rxjs",
        zod: "Zod",
      };
      return options;
    },
  },
]);
