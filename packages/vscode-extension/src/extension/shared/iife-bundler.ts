import * as path from "node:path";
import * as fs from "node:fs";
import { build } from "rolldown";
import { createRequire, isBuiltin } from "node:module";

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

// Node builtins can appear in transitive deps of the user's source file
// (e.g. a markdown lib imports "path"). In an IIFE bundle without a globals
// map entry, rolldown emits `var node_path = node_path;` which then throws
// `node_path is not defined` at runtime. Route builtins to empty modules
// instead of externalizing; the browser code path that actually needs them
// either never runs or gets a specific shim (crypto).
const BUILTIN_STUB_ID = "\0copilotkit-builtin-stub";
const BUILTIN_CRYPTO_SHIM_ID = "\0copilotkit-builtin-crypto";

// Same WebCrypto forwarding shim as tsdown.config.ts uses — react-core's
// ThreadsProvider calls `randomUUID()` / `uuid.v4()` at first render, and
// `crypto.randomFillSync` is the most-used entry through the uuid package.
const CRYPTO_SHIM_SOURCE = `
const webCrypto = globalThis.crypto;
export function randomFillSync(buf) {
  webCrypto.getRandomValues(buf);
  return buf;
}
export function randomBytes(size) {
  const buf = new Uint8Array(size);
  webCrypto.getRandomValues(buf);
  return buf;
}
export function randomUUID() {
  return webCrypto.randomUUID();
}
const shim = { randomFillSync, randomBytes, randomUUID };
export default shim;
`;

/**
 * Rolldown plugin that resolves bare specifiers using Node's module resolution
 * as a fallback: tries the importer's directory first (the user's project),
 * then the extension's own node_modules. Bare specifiers that both lookups
 * fail on are returned as `null` so Rolldown surfaces the resolution error.
 */
function matchesExternal(
  source: string,
  external: ReadonlyArray<string | RegExp>,
): boolean {
  return external.some((e) =>
    typeof e === "string" ? e === source : e.test(source),
  );
}

function nodeResolveFallback(
  skipPrefixes: string[] = [],
  external: ReadonlyArray<string | RegExp> = [],
) {
  return {
    name: "node-resolve-fallback",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      if (source.startsWith(".") || path.isAbsolute(source)) return null;
      if (skipPrefixes.some((p) => source === p || source.startsWith(p))) {
        return null;
      }
      // If the caller explicitly configured `external` to include this
      // specifier (or a matching regex), defer to their intent — they may
      // want to supply a browser polyfill at runtime.
      if (matchesExternal(source, external)) return null;
      // Node builtins — route through a virtual module rather than
      // marking external. In IIFE format without a globals entry, an
      // external emits `var node_path = node_path;` which is undefined at
      // runtime. A stub (or WebCrypto shim for `crypto`) avoids that and
      // keeps the bundled source runnable as long as nothing actually
      // *calls* the missing API.
      const bare = source.startsWith("node:") ? source.slice(5) : source;
      if (isBuiltin(bare)) {
        if (bare === "crypto") return BUILTIN_CRYPTO_SHIM_ID;
        return BUILTIN_STUB_ID;
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
    load(id: string) {
      if (id === BUILTIN_STUB_ID) return "export default {};";
      if (id === BUILTIN_CRYPTO_SHIM_ID) return CRYPTO_SHIM_SOURCE;
      return null;
    },
  };
}

/**
 * Collects CSS imports into `cssChunks` and replaces them with an empty JS
 * module, since Rolldown has removed native CSS bundling. The collected CSS
 * is returned alongside the JS bundle so callers can inject it into the
 * webview at runtime.
 */
const CSS_VIRTUAL_PREFIX = "\0copilotkit-css:";
const CSS_VIRTUAL_SUFFIX = ".js";

function cssCollectorPlugin(cssChunks: string[]) {
  return {
    name: "copilotkit-css-collector",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith(".css")) return null;
      // Rewrite the id to a virtual JS module so rolldown doesn't route it
      // through its CSS pipeline (which no longer supports bundling).
      let realPath: string | null = null;
      if (path.isAbsolute(source)) {
        realPath = source;
      } else if (source.startsWith(".") && importer) {
        realPath = path.resolve(path.dirname(importer), source);
      } else if (importer) {
        // Bare specifier like "katex/dist/katex.min.css" — resolve via the
        // importer's module graph so we find the real file on disk.
        try {
          const importerRequire = createRequire(
            path.join(path.dirname(importer), "package.json"),
          );
          realPath = importerRequire.resolve(source);
        } catch {
          try {
            realPath = extensionRequire.resolve(source);
          } catch {
            /* fall through */
          }
        }
      }
      if (!realPath) return null;
      return {
        id: `${CSS_VIRTUAL_PREFIX}${realPath}${CSS_VIRTUAL_SUFFIX}`,
      };
    },
    load(id: string) {
      if (!id.startsWith(CSS_VIRTUAL_PREFIX) || !id.endsWith(CSS_VIRTUAL_SUFFIX)) {
        return null;
      }
      const realPath = id.slice(
        CSS_VIRTUAL_PREFIX.length,
        id.length - CSS_VIRTUAL_SUFFIX.length,
      );
      try {
        cssChunks.push(fs.readFileSync(realPath, "utf-8"));
      } catch {
        /* ignore unreadable CSS */
      }
      return "export default undefined;";
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
    const cssChunks: string[] = [];
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
      plugins: [
        cssCollectorPlugin(cssChunks),
        nodeResolveFallback(opts.skipSpecifierPrefixes, opts.external),
      ],
      logLevel: "silent",
    });

    const jsOutput = result.output.find(
      (o) => o.type === "chunk" || o.fileName.endsWith(".js"),
    );
    if (!jsOutput || !("code" in jsOutput)) {
      return { success: false, error: "No output generated" };
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
