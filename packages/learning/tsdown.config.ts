import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", react: "src/react.tsx" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  external: ["react", "react/jsx-runtime"],
});
