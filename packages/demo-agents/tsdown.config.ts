import { defineConfig } from "tsdown";
import { withTypesConditions } from "../../scripts/tsdown-exports.mjs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  exports: { customExports: withTypesConditions },
});
