import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  noExternal: ["@copilotkit/intelligence-delivery-core"],
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  noExternal: ["@copilotkit/intelligence-delivery-core"],
});
