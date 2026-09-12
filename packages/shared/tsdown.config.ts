import { defineConfig } from "tsdown";

export default defineConfig([
  {
    // `src/telemetry/index.ts` is a second entry so that the Node-only
    // telemetry client is reachable as `@copilotkit/shared/telemetry`. The
    // root entry deliberately does not re-export it (#4151).
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
    external: [
      "zod",
      "graphql",
      "uuid",
      "@ag-ui/core",
      "@ag-ui/client",
      "partial-json",
    ],
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        zod: "Zod",
        graphql: "GraphQL",
        uuid: "UUID",
        "@ag-ui/core": "AgUICore",
        "@ag-ui/client": "AgUIClient",
        "@segment/analytics-node": "SegmentAnalyticsNode",
        chalk: "chalk",
        "partial-json": "PartialJSON",
      };
      return options;
    },
  },
]);
