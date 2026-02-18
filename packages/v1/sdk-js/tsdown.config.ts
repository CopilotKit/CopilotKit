import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    langchain: "src/langchain.ts",
    langgraph: "src/langgraph/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  exclude: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/*"],
  exports: true,
});
