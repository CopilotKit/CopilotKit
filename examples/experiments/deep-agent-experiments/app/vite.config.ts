import { defineConfig, type Plugin, type Alias } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import viteFastify from "@fastify/vite/plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import path from "path";

const LOCAL_CK = !!process.env.LOCAL_COPILOTKIT;

// ---------------------------------------------------------------------------
// Local CopilotKit source mode (LOCAL_COPILOTKIT=1)
// ---------------------------------------------------------------------------

const copilotKitRoot = path.resolve(import.meta.dirname, process.env.LOCAL_COPILOTKIT ?? "");
const nodeModules = path.resolve(import.meta.dirname, "node_modules");

function localCkAlias(find: RegExp, pkg: string): Alias {
  return { find, replacement: path.join(copilotKitRoot, pkg) };
}

function prebuiltAlias(find: RegExp, pkg: string): Alias {
  return { find, replacement: path.join(nodeModules, pkg) };
}

const localCkAliases: Alias[] = [
  // CSS sub-paths
  localCkAlias(/^@copilotkit\/react-core\/v2\/styles\.css$/, "v2/react/dist/styles.css"),
  localCkAlias(/^@copilotkit\/react-ui\/styles\.css$/, "v1/react-ui/src/styles.css"),
  localCkAlias(/^@copilotkitnext\/react\/styles\.css$/, "v2/react/dist/styles.css"),
  // JS sub-paths
  localCkAlias(/^@copilotkit\/react-core\/v2$/, "v1/react-core/src/v2/index.ts"),
  localCkAlias(/^@copilotkit\/runtime\/langgraph$/, "v1/runtime/src/langgraph.ts"),
  localCkAlias(/^@copilotkit\/runtime\/v2$/, "v1/runtime/src/v2/index.ts"),
  // Main entries
  localCkAlias(/^@copilotkit\/react-core$/, "v1/react-core/src/index.tsx"),
  localCkAlias(/^@copilotkit\/react-ui$/, "v1/react-ui/src/index.tsx"),
  localCkAlias(/^@copilotkit\/runtime$/, "v1/runtime/src/index.ts"),
  localCkAlias(/^@copilotkit\/shared$/, "v1/shared/src/index.ts"),
  localCkAlias(/^@copilotkit\/a2ui-renderer$/, "v1/a2ui-renderer/src/index.ts"),
  localCkAlias(/^@copilotkitnext\/core$/, "v2/core/src/index.ts"),
  localCkAlias(/^@copilotkitnext\/react$/, "v2/react/src/index.ts"),
  localCkAlias(/^@copilotkitnext\/shared$/, "v2/shared/src/index.ts"),
  localCkAlias(/^@copilotkitnext\/agent$/, "v2/agent/src/index.ts"),
  localCkAlias(/^@copilotkitnext\/runtime$/, "v2/runtime/src/index.ts"),
  // These packages can't be transpiled from source — use pre-built dist from npm
  prebuiltAlias(
    /^@copilotkit\/runtime-client-gql$/,
    "@copilotkit/runtime-client-gql/dist/index.mjs",
  ),
  prebuiltAlias(/^@copilotkitnext\/web-inspector$/, "@copilotkitnext/web-inspector/dist/index.mjs"),
];

// Resolve `@/` imports based on which package the importer lives in.
// CopilotKit's v2/react uses `@/` → its own `src/`, our app uses `@/` → `client/src/`.
import { existsSync, statSync, readFileSync } from "fs";
const tryExtensions = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

function resolveWithExtensions(base: string): string | undefined {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of tryExtensions) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
}

function scopedAtAlias(): Plugin {
  const appSrc = path.resolve(import.meta.dirname, "client/src");
  const ckReactSrc = path.join(copilotKitRoot, "v2/react/src");

  return {
    name: "scoped-at-alias",
    enforce: "pre",
    resolveId(source, importer) {
      if (!source.startsWith("@/")) return;
      const rel = source.slice(2);
      const base = importer?.startsWith(ckReactSrc)
        ? path.join(ckReactSrc, rel)
        : path.join(appSrc, rel);
      const resolved = resolveWithExtensions(base);
      if (resolved) return { id: resolved, external: false };
    },
  };
}

// ---------------------------------------------------------------------------
// Prevent @tailwindcss/vite from reprocessing pre-built CopilotKit CSS.
// The Tailwind plugin processes ALL .css modules in the Vite graph, stripping
// `cpk:` classes that aren't in the app's templates. Virtual modules and ?raw
// queries don't reliably bypass it.
//
// Nuclear option: inject CopilotKit CSS directly into the HTML via
// transformIndexHtml (outside the module graph entirely), and make the
// original CSS imports resolve to empty modules so Tailwind has nothing to strip.
// ---------------------------------------------------------------------------

function copilotKitCssPassthrough(): Plugin {
  const resolvedCssPaths = new Set<string>();

  return {
    name: "copilotkit-css-passthrough",
    enforce: "pre",

    // Intercept CopilotKit CSS imports → resolve to empty virtual module
    async resolveId(source, importer, options) {
      if (source.startsWith("\0") || source.includes("?")) return;
      if (!source.endsWith(".css")) return;

      const isCopilotKit =
        source.includes("@copilotkit/") ||
        source.includes("@copilotkitnext/") ||
        source.includes("/CopilotKit/packages/") ||
        (importer &&
          (importer.includes("node_modules/@copilotkit/") ||
            importer.includes("node_modules/@copilotkitnext/")));
      if (!isCopilotKit) return;

      // Already an absolute path (alias pre-resolved) — use directly
      if (source.startsWith("/")) {
        resolvedCssPaths.add(source);
        return "\0copilotkit-css-noop";
      }

      const resolution = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolution) return;

      resolvedCssPaths.add(resolution.id);
      return "\0copilotkit-css-noop";
    },

    load(id) {
      if (id === "\0copilotkit-css-noop") return "";
    },

    // Inject collected CSS directly into HTML (outside Vite's CSS pipeline)
    transformIndexHtml() {
      const tags: Array<{
        tag: string;
        attrs: Record<string, string>;
        children: string;
        injectTo: "head";
      }> = [];
      for (const cssPath of resolvedCssPaths) {
        try {
          let css = readFileSync(cssPath, "utf-8");
          // @fastify/vite embeds the transformed HTML inside a JS template
          // literal via `new Function("return \`...\`")`. Raw CSS injected
          // into <style> tags can break this: backticks terminate the
          // template, `${` starts an expression, and `\` is consumed as an
          // escape character (corrupting selectors like `.cpk\:prose`).
          // Escape all three so the template literal reproduces the original
          // CSS byte-for-byte.
          css = css.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
          tags.push({
            tag: "style",
            attrs: { "data-copilotkit-css": path.basename(cssPath) },
            children: css,
            injectTo: "head",
          });
        } catch {
          // File not found — skip
        }
      }
      return tags;
    },
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

if (LOCAL_CK) {
  console.log("\n  🔗 LOCAL_COPILOTKIT mode — using CopilotKit source from ../CopilotKit\n");
}

// https://vite.dev/config/
export default defineConfig({
  root: path.resolve(import.meta.dirname, "client"),
  plugins: [
    ...(LOCAL_CK ? [scopedAtAlias(), copilotKitCssPassthrough()] : [copilotKitCssPassthrough()]),
    viteFastify({ spa: true }),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: path.resolve(import.meta.dirname, "client/src/routes"),
      generatedRouteTree: path.resolve(import.meta.dirname, "client/src/routeTree.gen.ts"),
    }),
    tailwindcss(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
  ],
  resolve: {
    alias: LOCAL_CK ? localCkAliases : { "@": path.resolve(__dirname, "./client/src") },
    ...(LOCAL_CK && { dedupe: ["react", "react-dom"] }),
  },
  ...(LOCAL_CK && {
    server: {
      fs: {
        allow: [import.meta.dirname, copilotKitRoot],
      },
    },
  }),
});
