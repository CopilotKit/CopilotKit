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
    checks: { pluginTimings: false },
    exports: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitNextShared",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: ["zod"],
    codeSplitting: false,
    checks: { pluginTimings: false },
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        zod: "Zod",
        uuid: "uuid",
        "partial-json": "partialJson",
        "@ag-ui/client": "AgUIClient",
      };
      return options;
    },
  },
]);
