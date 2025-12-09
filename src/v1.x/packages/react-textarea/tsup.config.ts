import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}", "!src/**/__tests__/**/*"],
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  external: ["react"],
  sourcemap: true,
  ...options,
}));
