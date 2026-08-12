/// <reference types="node" />
import { defineConfig } from "tsdown";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolved path to src/v2/context.ts — used to redirect the headless build's
// relative ../context imports to the external @copilotkit/react-core/v2/context
// package path, ensuring a shared React context instance at runtime.
const configDir = path.dirname(fileURLToPath(import.meta.url));
const contextModulePath = path.resolve(configDir, "src/v2/context");

// Post-process the emitted declaration files. tsdown/rolldown-plugin-dts leaves
// two artifacts in the .d.ts/.d.cts/.d.mts output that break `attw` type
// resolution but do not affect the JS bundles:
//   1. Side-effect CSS imports (e.g. `import "./index.css"`) — TypeScript cannot
//      resolve a `.css` file as a typed module (InternalResolutionError). The CSS
//      import is intentionally kept in the JS so styles auto-load for bundler
//      consumers; only the declarations are cleaned.
//   2. The headless re-export of the externalized context module is emitted as a
//      relative `./context` import, which is invalid in ESM declarations
//      (extensionless). Rewrite it to the package subpath so it resolves under
//      node16/nodenext/bundler — matching how the JS bundle externalizes it.
// Run from `build:done` so it processes every format's declarations on disk,
// independent of per-output plugin order (the esm `.d.mts` and cjs `.d.cts` are
// emitted in separate passes).
const postProcessDeclarations = (dir: string) => {
  const cssImport = /^[ \t]*import\s+["'][^"']+\.css["'];?[ \t]*\r?\n/gm;
  const contextImport = /from\s+["']\.\.?\/context["']/g;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.d\.[cm]?ts$/.test(entry.name)) {
        const code = fs.readFileSync(full, "utf8");
        const next = code
          .replace(cssImport, "")
          .replace(contextImport, 'from "@copilotkit/react-core/v2/context"');
        if (next !== code) fs.writeFileSync(full, next);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
};

export default defineConfig([
  {
    entry: ["src/index.tsx", "src/v2/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    hooks: {
      "build:done": () => postProcessDeclarations(path.resolve("dist")),
    },
    external: [
      "react",
      "react-dom",
      "@copilotkit/core",
      "@copilotkit/shared",
      "@copilotkit/web-inspector",
      "@copilotkit/a2ui-renderer",
      // Keep @copilotkit/web-components (the Lit drawer element) + its subpaths
      // external. The drawer wrapper loads it via a client-only dynamic import;
      // bundling it inline ships a duplicate element + a second copy of lit-html,
      // which bloats the library and breaks Vite consumers ("Identifier 'h' has
      // already been declared") and risks double custom-element registration.
      // (The self-contained UMD builds below intentionally keep it inlined.)
      /^@copilotkit\/web-components(\/.*)?$/,
      "rxjs",
      /\.css$/,
    ],
    exports: {
      customExports: (exports) => ({
        ...exports,
        "./v2/context": {
          import: "./dist/v2/context.mjs",
          require: "./dist/v2/context.cjs",
        },
        "./v2/headless": {
          import: "./dist/v2/headless.mjs",
          require: "./dist/v2/headless.cjs",
        },
        "./v2/styles.css": "./dist/v2/index.css",
      }),
    },
  },
  // v2/context is built separately into dist/v2/ so it produces a standalone
  // file instead of being absorbed into shared chunks.
  {
    entry: {
      context: "src/v2/context.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist/v2",
    external: ["react", "@copilotkit/core", "@copilotkit/shared"],
  },
  // v2/headless: platform-agnostic hooks + CopilotKitCoreReact, used by
  // @copilotkit/react-native. All @copilotkit/* deps are external — they
  // contain no Node-only code that would break Metro. Keeping them external
  // (rather than inlining) ensures the CopilotKitCoreReact class is the same
  // nominal type as the one in v2/context, avoiding unsafe `as unknown as` casts.
  {
    entry: {
      headless: "src/v2/headless.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist/v2",
    plugins: [
      {
        name: "externalize-context",
        resolveId(source, importer) {
          // When any file imports ../context or ./context, redirect to
          // the external package path so the context singleton is shared.
          if (importer && /context(\.ts)?$/.test(source)) {
            const resolved = path.resolve(path.dirname(importer), source);
            if (
              resolved === contextModulePath ||
              resolved === contextModulePath + ".ts"
            ) {
              return {
                id: "@copilotkit/react-core/v2/context",
                external: true,
              };
            }
          }
          return null;
        },
      },
    ],
    external: [
      "react",
      "@ag-ui/client",
      "@ag-ui/core",
      "@copilotkit/core",
      "@copilotkit/shared",
      "@copilotkit/react-core/v2/context",
      "uuid",
      "zod",
      "rxjs",
    ],
  },
  {
    entry: ["src/index.tsx"],
    format: ["umd"],
    globalName: "CopilotKitReactCore",
    sourcemap: true,
    target: "es2020",
    outDir: "dist",
    external: [
      "react",
      "react-dom",
      "@copilotkit/core",
      "@copilotkit/shared",
      "@copilotkit/runtime-client-gql",
      "@copilotkit/web-inspector",
      "@copilotkit/a2ui-renderer",
      "@ag-ui/client",
      "zod",
      /\.css$/,
    ],
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "react-dom": "ReactDOM",
        "react/jsx-runtime": "ReactJsxRuntime",
        "@copilotkit/core": "CopilotKitCore",
        "@copilotkit/shared": "CopilotKitShared",
        "@copilotkit/runtime-client-gql": "CopilotKitRuntimeClientGQL",
        "@copilotkit/web-inspector": "CopilotKitWebInspector",
        "@copilotkit/a2ui-renderer": "CopilotKitA2UIRenderer",
        "@ag-ui/client": "AgUIClient",
        "react-markdown": "ReactMarkdown",
        zod: "Zod",
      };
      return options;
    },
  },
  {
    entry: ["src/v2/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitReactCoreV2",
    sourcemap: true,
    target: "es2020",
    outDir: "dist/v2",
    external: [
      "react",
      "react-dom",
      "@copilotkit/core",
      "@copilotkit/shared",
      "@copilotkit/runtime-client-gql",
      "@copilotkit/web-inspector",
      "@copilotkit/a2ui-renderer",
      "@ag-ui/client",
      "@ag-ui/core",
      "zod",
      /\.css$/,
    ],
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "react-dom": "ReactDOM",
        "react/jsx-runtime": "ReactJsxRuntime",
        "@copilotkit/core": "CopilotKitCore",
        "@copilotkit/shared": "CopilotKitShared",
        "@copilotkit/runtime-client-gql": "CopilotKitRuntimeClientGQL",
        "@copilotkit/web-inspector": "CopilotKitWebInspector",
        "@copilotkit/a2ui-renderer": "CopilotKitA2UIRenderer",
        "@ag-ui/client": "AgUIClient",
        "@ag-ui/core": "AgUICore",
        "react-markdown": "ReactMarkdown",
        zod: "Zod",
        "tailwind-merge": "tailwindMerge",
        "lucide-react": "lucideReact",
        "@radix-ui/react-slot": "RadixReactSlot",
        "class-variance-authority": "classVarianceAuthority",
        clsx: "clsx",
        "@radix-ui/react-tooltip": "RadixReactTooltip",
        "@radix-ui/react-dropdown-menu": "RadixReactDropdownMenu",
        "katex/dist/katex.min.css": "katexCss",
        streamdown: "streamdown",
        "@lit-labs/react": "LitLabsReact",
        "use-stick-to-bottom": "useStickToBottom",
        "ts-deepmerge": "tsDeepmerge",
      };
      return options;
    },
  },
]);
