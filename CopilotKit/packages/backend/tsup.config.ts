import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: ["src/**/*.{ts,tsx}"],
  format: ["esm"],
  dts: true,
  minify: false,
  clean: true,
  external: [],
  sourcemap: true,
  exclude: [
    "**/*.test.ts", // Exclude TypeScript test files
    "**/*.test.tsx", // Exclude TypeScript React test files
    "**/__tests__/*", // Exclude any files inside a __tests__ directory
  ],
  ...options,
}));
