import { defineConfig } from "tsdown";

// NOTE: unlike the other tsdown-built packages, this config sets no `exports`
// option, so tsdown does NOT generate/overwrite package.json `exports` — the
// map (including the per-entry `types` conditions required by issue #3324) is
// hand-maintained in package.json. The `pnpm validate:exports` CI gate guards
// it against a missing `types` condition. If entry points change here, update
// the `exports` map in package.json by hand to match.
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/components/index.ts",
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
    "@ag-ui/client",
    "@copilotkit/react-core",
    "@copilotkit/core",
    "@copilotkit/shared",
    "@gorhom/bottom-sheet",
    "react-native-streamdown",
    "react-native-gesture-handler",
    "react-native-reanimated",
    "react-native-enriched-markdown",
    "react-native-worklets",
    "remend",
  ],
});
