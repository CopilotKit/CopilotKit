import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/**/__tests__/**/*",
    "!src/**/*.spec.{ts,tsx}",
  ],
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

    // Validation - peer dependency, should match app's version
    "zod",
  ],
  sourcemap: true,
  ...options,
}));
