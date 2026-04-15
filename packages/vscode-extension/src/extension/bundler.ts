import * as path from "node:path";
import { build } from "rolldown";
import { createRequire } from "node:module";

export interface BundleResult {
  success: boolean;
  code?: string;
  css?: string;
  error?: string;
}

// Create a require function scoped to this extension's directory.
// This lets the fallback resolver find packages (like zod) installed
// in the extension's own node_modules, even when the user's project
// doesn't have them directly accessible (e.g., pnpm strict mode).
const extensionRequire = createRequire(__filename);

/**
 * Rolldown plugin that resolves bare specifiers using Node's module
 * resolution as a fallback. Tries the importer's directory first
 * (the user's project), then the extension's own node_modules.
 */
function nodeResolveFallback() {
  return {
    name: "node-resolve-fallback",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      // Skip relative/absolute imports — Rolldown handles these fine
      if (source.startsWith(".") || path.isAbsolute(source)) return null;

      // Try resolving from the importer's directory (user's project)
      if (importer) {
        try {
          const importerDir = path.dirname(importer);
          const importerRequire = createRequire(
            path.join(importerDir, "package.json"),
          );
          return { id: importerRequire.resolve(source), external: false };
        } catch {
          // Fall through to extension fallback
        }
      }

      // Fallback: resolve from the extension's own node_modules
      try {
        return { id: extensionRequire.resolve(source), external: false };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Extract Tailwind class candidates from a JS/TS source string.
 * Scans for className patterns and splits on whitespace.
 */
function extractTailwindCandidates(code: string): string[] {
  const candidates = new Set<string>();
  const patterns = [
    /className\s*[:=]\s*"([^"]+)"/g,
    /className\s*[:=]\s*'([^']+)'/g,
    /class\s*[:=]\s*"([^"]+)"/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      for (const cls of match[1].split(/\s+/)) {
        if (cls && /^[a-z]/.test(cls) && !cls.includes("(")) {
          candidates.add(cls);
        }
      }
    }
  }
  return [...candidates];
}

// Lazily compiled Tailwind instance (reused across builds for speed)
let tailwindCompiled: { build: (candidates: string[]) => string } | null =
  null;

async function compileTailwindCss(candidates: string[]): Promise<string> {
  if (candidates.length === 0) return "";
  try {
    if (!tailwindCompiled) {
      // Access @tailwindcss/node through @tailwindcss/cli's dependency
      const cliPkgPath = extensionRequire.resolve(
        "@tailwindcss/cli/package.json",
      );
      const nodeRequire = createRequire(cliPkgPath);
      const { compile } = nodeRequire("@tailwindcss/node");
      tailwindCompiled = await compile('@import "tailwindcss";', {
        base: path.dirname(cliPkgPath),
        onDependency: () => {},
      });
    }
    return tailwindCompiled.build(candidates);
  } catch {
    return "";
  }
}

/**
 * Bundles a catalog component file into an IIFE string plus CSS.
 *
 * CSS comes from two sources:
 * 1. CSS files imported by the component (extracted by Rolldown)
 * 2. Tailwind utility classes found in the code (JIT compiled at runtime)
 *
 * React and @copilotkit/* are externalized and mapped to globals.
 * Everything else (zod, etc.) is bundled into the IIFE.
 */
export async function bundleCatalog(entryPath: string): Promise<BundleResult> {
  try {
    const result = await build({
      input: entryPath,
      write: false,
      output: {
        format: "iife",
        name: "__copilotkit_catalog",
        exports: "named",
        globals: {
          react: "__copilotkit_deps.React",
          "react-dom": "__copilotkit_deps.ReactDOM",
          "react-dom/client": "__copilotkit_deps.ReactDOMClient",
          "react/jsx-runtime": "__copilotkit_deps.JSXRuntime",
          "react/jsx-dev-runtime": "__copilotkit_deps.JSXRuntime",
          "@copilotkit/a2ui-renderer": "__copilotkit_deps.A2UIRenderer",
        },
      },
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        /^@copilotkit\//,
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

    // Collect CSS from Rolldown (from import "./styles.css" etc.)
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

    // Generate Tailwind CSS from class candidates in the bundled code
    const candidates = extractTailwindCandidates(jsOutput.code);
    const tailwindCss = await compileTailwindCss(candidates);
    if (tailwindCss) {
      cssChunks.push(tailwindCss);
    }

    const css = cssChunks.length > 0 ? cssChunks.join("\n") : undefined;

    return { success: true, code: jsOutput.code, css };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
