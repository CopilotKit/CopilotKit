import { defineConfig, Options } from "tsup";
import { Plugin } from "esbuild";
import { generate } from "@graphql-codegen/cli";
import codegenConfig from "./codegen";

const runBeforeBuildPlugin: Plugin = {
  name: "run-before-build",
  setup(build) {
    const prefix = build.initialOptions.format;

    build.onStart(async () => {
      console.log(`[${prefix}] Running graphql-codegen`);
      await generate(codegenConfig);
      console.log(`[${prefix}] graphql-codegen completed successfully`);
    });
  },
};

export default defineConfig((options: Options) => ({
  entry: ["src/**/*.{ts,tsx}"],
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  external: ["react"],
  sourcemap: true,
  exclude: [
    "**/*.test.ts", // Exclude TypeScript test files
    "**/*.test.tsx", // Exclude TypeScript React test files
    "**/__tests__/*", // Exclude any files inside a __tests__ directory
  ],
  esbuildPlugins: [runBeforeBuildPlugin as any],
  ...options,
}));
