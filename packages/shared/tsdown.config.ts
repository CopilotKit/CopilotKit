import { defineConfig } from "tsdown";

// `partial-json` only ships CommonJS, which makes Angular's esbuild warn about
// optimization bailouts (#7654). Bundle it into every format so consumers get
// ESM, and keep it out of the published `dependencies`.
const bundled = ["partial-json"];

export default defineConfig([
  {
    // Node-only telemetry and event transforms have separate entries.
    // The browser-facing root must not re-export either (#4151).
    entry: [
      "src/index.ts",
      "src/telemetry/index.ts",
      "src/event-transforms/index.ts",
    ],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    exports: true,
    noExternal: bundled,
    inlineOnly: bundled,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitShared",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: ["zod", "graphql", "uuid", "@ag-ui/core", "@ag-ui/client"],
    noExternal: bundled,
    inlineOnly: bundled,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        zod: "Zod",
        graphql: "GraphQL",
        uuid: "UUID",
        "@ag-ui/core": "AgUICore",
        "@ag-ui/client": "AgUIClient",
        "@segment/analytics-node": "SegmentAnalyticsNode",
      };
      return options;
    },
  },
]);
