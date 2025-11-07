import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}", "!src/**/__tests__/**/*"],
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  external: [
    // React peer dependencies - must be shared with consuming app
    "react",
    "react-dom",

    // vnext packages - must be shared with consuming app
    "@copilotkitnext/core",
    "@copilotkitnext/react",
  ],
  sourcemap: true,
  ...options,
}));
