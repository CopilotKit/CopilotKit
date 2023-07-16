import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  treeshake: true,
  splitting: true,
  entry: ["src/**/*.{ts,tsx}"],
  format: ["esm"],
  dts: true,
  minify: false,
  clean: true,
  external: ["react"],
  sourcemap: true,
  ...options,
}));
