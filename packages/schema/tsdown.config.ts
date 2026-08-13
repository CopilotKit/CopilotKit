import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/streaming.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
});
