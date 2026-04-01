import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  ...options,
  clean: true,
  entry: ["src/**/*.ts"],
  format: ["esm"],
  dts: true,
  minify: false,
  external: [],
  splitting: false,
  sourcemap: true,
  exclude: [],
}));
