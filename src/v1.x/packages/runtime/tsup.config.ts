import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  ...options,
  entry: ["src/index.ts", "src/v2/index.ts", "src/langgraph.ts"],
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  external: ["@ag-ui/langgraph"],
  sourcemap: true,
  exclude: [
    "**/*.test.ts", // Exclude TypeScript test files
    "**/*.test.tsx", // Exclude TypeScript React test files
    "**/__tests__/*", // Exclude any files inside a __tests__ directory
  ],
  treeshake: true,
  // Disable code splitting so each entry point is fully independent
  // This prevents @ag-ui/langgraph from being pulled into index.mjs via shared chunks
  splitting: false,
}));
