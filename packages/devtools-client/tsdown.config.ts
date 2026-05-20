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
    // @tanstack/devtools-event-client has no UMD distribution, so we force it
    // into the bundle for CDN consumers (unpkg/jsdelivr).
    noExternal: ["@tanstack/devtools-event-client"],
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      return options;
    },
  },
]);
