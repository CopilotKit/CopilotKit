import { defineConfig } from "tsdown";

export default defineConfig([
  // Extension host — Node.js, CJS (what VS Code loads)
  {
    entry: ["src/extension/activate.ts"],
    format: ["cjs"],
    platform: "node",
    outDir: "dist/extension",
    external: ["vscode"],
    sourcemap: true,
  },
  // Webview app — browser, IIFE (loaded via <script> tag)
  {
    entry: ["src/webview/index.tsx"],
    format: ["iife"],
    platform: "browser",
    outDir: "dist/webview",
    sourcemap: true,
    external: [],
  },
]);
