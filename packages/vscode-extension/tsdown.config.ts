import { defineConfig } from "tsdown";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

/**
 * Rolldown plugin that resolves bare specifiers using Node's module
 * resolution. Needed because pnpm's strict node_modules doesn't hoist
 * transitive dependencies (e.g., zod from @copilotkit/a2ui-renderer).
 */
function nodeResolveFallback() {
  return {
    name: "node-resolve-fallback",
    enforce: "pre" as const,
    resolveId(source: string) {
      // Skip relative, absolute, node builtins, and vscode
      if (
        source.startsWith(".") ||
        path.isAbsolute(source) ||
        source.startsWith("node:") ||
        source === "vscode"
      ) {
        return null;
      }
      try {
        return { id: require.resolve(source), external: false };
      } catch {
        return null;
      }
    },
  };
}

export default defineConfig([
  // Extension host — Node.js, CJS (what VS Code loads)
  {
    entry: ["src/extension/activate.ts"],
    format: ["cjs"],
    platform: "node",
    outDir: "dist/extension",
    external: ["vscode", /^node:/],
    sourcemap: true,
    plugins: [nodeResolveFallback()],
  },
  // Webview app — browser, IIFE (loaded via <script> tag)
  {
    entry: ["src/webview/index.tsx"],
    format: ["iife"],
    platform: "browser",
    outDir: "dist/webview",
    sourcemap: true,
    external: [],
    // Force-bundle everything — tsdown auto-externalizes node_modules by default,
    // but we need all deps (zod, a2ui-renderer, etc.) inlined for the webview.
    noExternal: [/.*/],
    plugins: [nodeResolveFallback()],
  },
]);
