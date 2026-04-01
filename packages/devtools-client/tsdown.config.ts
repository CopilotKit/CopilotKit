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
    exports: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitDevtoolsClient",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: ["@tanstack/devtools-event-client", "@ag-ui/client"],
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        "@tanstack/devtools-event-client": "TanStackDevtoolsEventClient",
        "@ag-ui/client": "AgUIClient",
      };
      return options;
    },
  },
]);
