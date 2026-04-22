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

// Markdown-pipeline deps pulled in transitively by @copilotkit/react-core's
// chat UI. None of them are reachable on the hook-preview runtime path
// (we mount the user's component but never trigger markdown rendering),
// and several have node-vs-browser conditional exports that produce
// MISSING_EXPORT errors once Node builtins are stubbed (e.g. vfile's
// `#minurl` loses `urlToPath` on the browser condition).
//
// Each entry lists the named exports dependents statically import. The
// stub emits those names as `undefined` so rolldown's named-export
// analysis succeeds; if a new dep breaks the build with a
// "MISSING_EXPORT" error, add its exports here.
const STUBBED_TRANSITIVE_DEPS: Record<string, string[]> = {
  vfile: ["VFile"],
  "stringify-entities": ["stringifyEntities"],
  "parse-entities": ["parseEntities"],
  "character-entities": ["characterEntities"],
  "character-entities-legacy": ["characterEntitiesLegacy"],
  "character-reference-invalid": ["characterReferenceInvalid"],
  "decode-named-character-reference": ["decodeNamedCharacterReference"],
  "hast-util-to-html": ["toHtml"],
};
const STUB_DEP_PREFIX = "\0copilotkit-stub-dep:";

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

// Workspace CopilotKit packages ship CJS dist entries that rolldown wraps in
// `__commonJSMin`. Those wrappers trigger TDZ errors
// (`Cannot access 'require_<pkg>' before initialization`) when the bundle
// contains circular imports through the react-core/chat/runtime-client graph.
// Resolving to the TS source bypasses the CJS wrapper entirely — ESM imports
// rolldown handles cleanly.
//
// Mirrors the `workspaceSourceAliases` map in `tsdown.config.ts`, which does
// the same redirection for the extension's own webview build. When the
// extension is running from a monorepo checkout each src path exists; when
// installed from the marketplace against a user project that pulled the
// packages from npm, the src path won't exist, we fall through to normal Node
// resolution, and the CJS TDZ is back as a live concern — that case is a
// separate production issue tracked outside this file.
const WORKSPACE_SOURCE_PKGS = [
  "@copilotkit/a2ui-renderer",
  "@copilotkit/shared",
  "@copilotkit/runtime-client-gql",
];

function buildWorkspaceSourceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const pkg of WORKSPACE_SOURCE_PKGS) {
    try {
      const pkgJson = extensionRequire.resolve(`${pkg}/package.json`);
      const srcIndex = path.join(path.dirname(pkgJson), "src", "index.ts");
      if (fs.existsSync(srcIndex)) aliases[pkg] = srcIndex;
    } catch {
      /* package not installed / resolvable — skip */
    }
  }
  return aliases;
}

const WORKSPACE_SOURCE_ALIASES = buildWorkspaceSourceAliases();

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
      // If the caller explicitly configured `external` to include this
      // specifier (or a matching regex), defer to their intent — they may
      // want to supply a browser polyfill at runtime.
      if (matchesExternal(source, external)) return null;
      // Node builtins MUST be checked before `skipPrefixes` — a caller that
      // passes ["node:"] as a skip (to avoid treating `node:*` as a bare
      // specifier for node_modules resolution) would otherwise short-circuit
      // past our stub, which is the bug that caused
      // `var node_path = node_path;` to land in the IIFE and throw
      // 'node_path is not defined' in the webview.
      //
      // Route builtins through a virtual module rather than marking them
      // external. In IIFE format without a globals entry, an external is
      // emitted as a self-assign that's undefined at runtime; a stub (or
      // WebCrypto shim for `crypto`) avoids that and keeps the bundled
      // source runnable as long as nothing actually *calls* the missing API.
      const bare = source.startsWith("node:") ? source.slice(5) : source;
      if (isBuiltin(bare)) {
        if (bare === "crypto") return BUILTIN_CRYPTO_SHIM_ID;
        return BUILTIN_STUB_ID;
      }
      // Unreachable markdown-chain deps pulled in by react-core's chat UI.
      if (source in STUBBED_TRANSITIVE_DEPS) {
        return STUB_DEP_PREFIX + source;
      }
      if (skipPrefixes.some((p) => source === p || source.startsWith(p))) {
        return null;
      }
      // Workspace CopilotKit packages → TS source. Must run before Node
      // resolution, which would find the CJS dist and trigger a TDZ error
      // under circular imports (see WORKSPACE_SOURCE_PKGS note above).
      if (source in WORKSPACE_SOURCE_ALIASES) {
        return { id: WORKSPACE_SOURCE_ALIASES[source] };
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
      if (id.startsWith(STUB_DEP_PREFIX)) {
        const spec = id.slice(STUB_DEP_PREFIX.length);
        const names = STUBBED_TRANSITIVE_DEPS[spec] ?? [];
        const lines = names.map((n) => `export const ${n} = undefined;`);
        lines.push("export default {};");
        return lines.join("\n");
      }
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
      if (
        !id.startsWith(CSS_VIRTUAL_PREFIX) ||
        !id.endsWith(CSS_VIRTUAL_SUFFIX)
      ) {
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
