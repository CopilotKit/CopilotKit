import * as path from "node:path";
import { build } from "rolldown";
import { createRequire } from "node:module";

export interface IifeBundleResult {
  success: boolean;
  code?: string;
  css?: string;
  error?: string;
}

export interface IifeBundleOptions {
  entryPath: string;
  /** Global name the IIFE assigns to (e.g. "__copilotkit_catalog"). */
  iifeName: string;
  /** Module specifiers to mark as external (strings or regex). */
  external: Array<string | RegExp>;
  /**
   * Map from external specifier to the global variable name where the webview
   * exposes that module at runtime (e.g. react → "__copilotkit_deps.React").
   */
  globals: Record<string, string>;
  /**
   * Extra specifier prefixes that the resolver should silently skip rather
   * than attempt to resolve (e.g. "node:" builtins, "vscode"). Useful when
   * the bundled source may transitively reference extension-host-only code.
   */
  skipSpecifierPrefixes?: string[];
}

// Create a require function scoped to this extension's directory so the
// fallback resolver can find packages (like zod) installed in the extension's
// own node_modules even when the user's project doesn't have them directly
// accessible (e.g. pnpm strict mode).
const extensionRequire = createRequire(__filename);

/**
 * Rolldown plugin that resolves bare specifiers using Node's module resolution
 * as a fallback: tries the importer's directory first (the user's project),
 * then the extension's own node_modules. Bare specifiers that both lookups
 * fail on are returned as `null` so Rolldown surfaces the resolution error.
 */
function nodeResolveFallback(skipPrefixes: string[] = []) {
  return {
    name: "node-resolve-fallback",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      if (source.startsWith(".") || path.isAbsolute(source)) return null;
      if (skipPrefixes.some((p) => source === p || source.startsWith(p))) {
        return null;
      }

      if (importer) {
        try {
          const importerDir = path.dirname(importer);
          const importerRequire = createRequire(
            path.join(importerDir, "package.json"),
          );
          return { id: importerRequire.resolve(source) };
        } catch {
          /* fall through */
        }
      }

      try {
        return { id: extensionRequire.resolve(source) };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Bundles an entry file into an IIFE string (plus CSS collected from any
 * CSS imports). Used for loading user source files into a webview. React and
 * any other singletons configured via `external` + `globals` are hoisted to
 * `__copilotkit_deps.*` at runtime; everything else is bundled in.
 */
export async function bundleIife(
  opts: IifeBundleOptions,
): Promise<IifeBundleResult> {
  try {
    const result = await build({
      input: opts.entryPath,
      write: false,
      output: {
        format: "iife",
        name: opts.iifeName,
        exports: "named",
        globals: opts.globals,
      },
      external: opts.external,
      plugins: [nodeResolveFallback(opts.skipSpecifierPrefixes)],
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
