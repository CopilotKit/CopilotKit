import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/polyfills.ts",
    "src/polyfills/streams.ts",
    "src/polyfills/encoding.ts",
    "src/polyfills/crypto.ts",
    "src/polyfills/dom.ts",
    "src/polyfills/location.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  external: [
    "react",
    "react-native",
    "@copilotkit/react-core",
    "@copilotkit/core",
    "@copilotkit/shared",
  ],
});
