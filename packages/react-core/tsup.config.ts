import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: ["src/**/*.{ts,tsx}"],
  format: ["esm"],
  dts: true,
  minify: false,
  clean: true,
  external: ["react"],
  sourcemap: true,
  ...options,
}));
