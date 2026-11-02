import { defineConfig } from "tsdown";

export default defineConfig([
  {
    // Node-only telemetry has a separate entry. The browser-facing root must
    // not re-export it (#4151).
    entry: ["src/index.ts", "src/telemetry/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    exports: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitShared",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: ["zod", "@ag-ui/core", "@ag-ui/client", "partial-json"],
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        zod: "Zod",
        "@ag-ui/core": "AgUICore",
        "@ag-ui/client": "AgUIClient",
        "@segment/analytics-node": "SegmentAnalyticsNode",
        "partial-json": "PartialJSON",
      };
      return options;
    },
  },
]);
