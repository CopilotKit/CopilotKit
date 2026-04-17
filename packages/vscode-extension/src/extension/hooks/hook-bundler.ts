import * as path from "node:path";
import { build } from "rolldown";
import { createRequire } from "node:module";

export interface HookBundleResult {
  success: boolean;
  code?: string;
  css?: string;
  error?: string;
}

// Create a require function scoped to this extension's directory so the
// fallback resolver can find packages installed in the extension's own
// node_modules (mirrors the pattern used in `bundler.ts`).
const extensionRequire = createRequire(__filename);

/**
 * Rolldown plugin that resolves bare specifiers via Node's module
 * resolution as a fallback. Tries the importer's directory first
 * (the user's project), then the extension's own node_modules.
 */
function nodeResolveFallback() {
  return {
    name: "node-resolve-fallback",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      if (source.startsWith(".") || path.isAbsolute(source)) return null;
      if (source.startsWith("node:") || source === "vscode") return null;
      if (importer) {
        try {
          const importerDir = path.dirname(importer);
          const importerRequire = createRequire(
            path.join(importerDir, "package.json"),
          );
          return { id: importerRequire.resolve(source), external: false };
        } catch {
          /* fall through */
        }
      }
      try {
        return { id: extensionRequire.resolve(source), external: false };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Bundles a user's hook-site source file into an IIFE string plus CSS.
 *
 * Unlike `bundleCatalog`, this bundler externalizes ONLY React — every
 * other dependency (including `@copilotkit/*` from the user's
 * `node_modules`) is bundled into the IIFE. The webview exposes React
 * as a singleton on `__copilotkit_deps`.
 */
export async function bundleHookSite(
  entryPath: string,
): Promise<HookBundleResult> {
  try {
    const result = await build({
      input: entryPath,
      write: false,
      output: {
        format: "iife",
        name: "__copilotkit_hookSite",
        exports: "named",
        globals: {
          react: "__copilotkit_deps.React",
          "react-dom": "__copilotkit_deps.ReactDOM",
          "react-dom/client": "__copilotkit_deps.ReactDOMClient",
          "react/jsx-runtime": "__copilotkit_deps.JSXRuntime",
          "react/jsx-dev-runtime": "__copilotkit_deps.JSXRuntime",
        },
      },
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      plugins: [nodeResolveFallback()],
      logLevel: "silent",
    });

    const jsOutput = result.output.find(
      (o) => o.type === "chunk" || o.fileName.endsWith(".js"),
    );
    if (!jsOutput || !("code" in jsOutput)) {
      return { success: false, error: "No output generated" };
    }

    const cssChunks: string[] = [];
    for (const o of result.output) {
      if (
        o.type === "asset" &&
        o.fileName.endsWith(".css") &&
        typeof o.source === "string"
      ) {
        cssChunks.push(o.source);
      }
    }

    return {
      success: true,
      code: jsOutput.code,
      css: cssChunks.length > 0 ? cssChunks.join("\n") : undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
