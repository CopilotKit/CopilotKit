import { defineConfig } from "tsdown";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

// Resolve workspace packages to their TypeScript source instead of compiled
// dist. This avoids CJS-to-ESM interop bugs in Rolldown (e.g., variable
// shadowing in __commonJSMin wrappers that cause TDZ errors).
const workspaceSourceAliases: Record<string, string> = {
  "@copilotkit/a2ui-renderer": path.resolve(
    import.meta.dirname,
    "../a2ui-renderer/src/index.ts",
  ),
};

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

      // Resolve workspace packages to TypeScript source
      if (source in workspaceSourceAliases) {
        return { id: workspaceSourceAliases[source], external: false };
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
  // Inspector webview — browser, ESM
  {
    entry: { inspector: "src/webview/inspector/index.tsx" },
    outDir: "dist/webview",
    format: ["esm"],
    platform: "browser",
    noExternal: [/.*/],
    dts: false,
    clean: false,
    plugins: [nodeResolveFallback()],
  },
  // Hook-preview webview — browser, ESM
  {
    entry: { "hook-preview": "src/webview/hook-preview/index.tsx" },
    outDir: "dist/webview",
    format: ["esm"],
    platform: "browser",
    noExternal: [/.*/],
    dts: false,
    clean: false,
    plugins: [nodeResolveFallback()],
  },
]);
