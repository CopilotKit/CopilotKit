import { defineConfig } from "tsdown";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  entry: ["src/index.ts", "src/express.ts", "src/hono.ts", "src/node.ts"],
  format: ["esm", "cjs"],
  dts: !isWatch,
  sourcemap: true,
  clean: !isWatch,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  checks: { pluginTimings: false },
  exports: true,
});
