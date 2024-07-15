import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  ...options,
  entry: ["src/**/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  external: [],
  sourcemap: true,
  exclude: [
    "**/*.test.ts", // Exclude TypeScript test files
    "**/*.test.tsx", // Exclude TypeScript React test files
    "**/__tests__/*", // Exclude any files inside a __tests__ directory
  ],
}));
