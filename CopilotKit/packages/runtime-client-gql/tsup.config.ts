import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: ["src/**/*.{ts,tsx}"],
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  external: ["react"],
  sourcemap: true,
  exclude: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/*"],
  ...options,
}));
