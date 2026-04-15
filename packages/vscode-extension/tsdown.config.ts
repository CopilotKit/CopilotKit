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
  // Webview app — browser, ESM (loaded via <script type="module">)
  // ESM format is required because @copilotkit/a2ui-renderer has circular
  // dependencies that break in IIFE/CJS format. ESM handles them via live bindings.
  {
    entry: ["src/webview/index.tsx"],
    format: ["esm"],
    platform: "browser",
    outDir: "dist/webview",
    sourcemap: true,
    external: [],
    noExternal: [/.*/],
    plugins: [nodeResolveFallback()],
  },
]);
