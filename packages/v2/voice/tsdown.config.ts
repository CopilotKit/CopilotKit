import { defineConfig } from "tsdown";

const isWatch = process.argv.includes("--watch");

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: !isWatch,
    sourcemap: true,
    clean: !isWatch,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    exports: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitVoice",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: [],
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        "@copilotkitnext/runtime": "CopilotKitNextRuntime",
        openai: "openai",
      };
      return options;
    },
  },
]);
