import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    external: ["rxjs"],
    checks: { pluginTimings: false },
    exports: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitCore",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: [
      "@copilotkit/shared",
      "@ag-ui/client",
      "@ag-ui/core",
      "rxjs",
      "zod",
    ],
    codeSplitting: false,
    checks: { pluginTimings: false },
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        "@copilotkit/shared": "CopilotKitShared",
        "@ag-ui/client": "AgUIClient",
        "@ag-ui/core": "AgUICore",
        rxjs: "rxjs",
        "rxjs/operators": "rxjs.operators",
        "zod-to-json-schema": "zodToJsonSchema",
        zod: "Zod",
      };
      return options;
    },
  },
]);
