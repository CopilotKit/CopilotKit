import { defineConfig } from "tsdown";

// Build each entry as an INDEPENDENT rolldown graph, each into its OWN outDir.
//
// A single multi-entry build cross-links the CJS chunks: rolldown injects an
// unused top-level `require('../react-native/index.cjs')` into the `/react` and
// `/vue` CJS bundles (shared interop assigned to the react-native chunk), and
// `react-native/index.cjs` eagerly does `require("react-native")`. Because CJS
// requires run for side effects, a web-only consumer doing
// `require("@copilotkit/markdown-renderer/react")` would crash with
// "Cannot find module 'react-native'" (react-native is an optional peer that web
// apps don't install).
//
// Separate builds keep each entry self-contained. They use DISTINCT outDirs so
// the concurrent builds never touch each other's files (a shared outDir caused
// tsdown to drop sibling output). `clean: false` everywhere — the `build` script
// removes `dist` once up-front.
const shared = {
  format: ["esm", "cjs"] as const,
  dts: true,
  sourcemap: true,
  target: "es2022",
  clean: false,
  external: [
    "react",
    "react/jsx-runtime",
    "react-dom",
    "vue",
    "react-native",
    "@copilotkit/markdown-renderer",
  ],
};

export default defineConfig([
  { ...shared, entry: { index: "src/index.ts" }, outDir: "dist" },
  { ...shared, entry: { index: "src/react/index.ts" }, outDir: "dist/react" },
  { ...shared, entry: { index: "src/vue/index.ts" }, outDir: "dist/vue" },
  { ...shared, entry: { index: "src/react-native/index.ts" }, outDir: "dist/react-native" },
]);
