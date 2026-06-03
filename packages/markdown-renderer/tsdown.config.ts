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
// apps don't install). Separate builds keep each entry self-contained.
//
// Only the root build cleans — it owns the top-level `dist/` and runs first, so
// its clean wipes stale output before the per-framework builds write into their
// own subdirs. Those use `clean: false` so they don't wipe the root's output
// (or each other's).
const shared = {
  format: ["esm", "cjs"] as const,
  dts: true,
  sourcemap: true,
  target: "es2022",
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
  { ...shared, entry: { index: "src/index.ts" }, outDir: "dist", clean: true },
  { ...shared, entry: { index: "src/react/index.ts" }, outDir: "dist/react", clean: false },
  { ...shared, entry: { index: "src/vue/index.ts" }, outDir: "dist/vue", clean: false },
  { ...shared, entry: { index: "src/react-native/index.ts" }, outDir: "dist/react-native", clean: false },
]);
