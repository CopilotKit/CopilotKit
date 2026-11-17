/// <reference types="node" />
import { defineConfig } from "tsdown";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolved path to src/v2/context.ts — used to redirect relative ../context
// imports (in the headless build and in the main build, which includes the
// `/v2/generative-ui/native` entry) to the external
// @copilotkit/react-core/v2/context package path, ensuring a shared React
// context instance at runtime.
const configDir = path.dirname(fileURLToPath(import.meta.url));
const contextModulePath = path.resolve(configDir, "src/v2/context");

// Post-process the emitted declaration files. tsdown/rolldown-plugin-dts leaves
// two artifacts in the .d.ts/.d.cts/.d.mts output that break `attw` type
// resolution but do not affect the JS bundles:
//   1. Side-effect CSS imports (e.g. `import "./index.css"`) — TypeScript cannot
//      resolve a `.css` file as a typed module (InternalResolutionError). The CSS
//      import is intentionally kept in the JS so styles auto-load for bundler
//      consumers; only the declarations are cleaned.
//   2. A reference to the externalized context module (the headless re-export,
//      and the `/v2/generative-ui/native` declarations) can be emitted as a
//      relative `./context` or `../context` import, which is invalid in ESM
//      declarations (extensionless). Rewrite it to the package subpath so it resolves under
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

// Redirects any relative `../context` / `./context` import that resolves to
// src/v2/context.ts onto the external `@copilotkit/react-core/v2/context`
// package path.
//
// src/v2/context.ts is emitted as its own entry (dist/v2/context.*) so React
// Native can consume it without dragging in the web bundle. Any build that ALSO
// inlines it ends up running `createContext()` a second time, producing a
// distinct context instance: `CopilotKitProvider` would publish to its inlined
// copy while consumers importing from `@copilotkit/react-core/v2/context` read
// the orphaned one and only ever see the defaults (e.g. `useLicenseContext()`
// stuck at `status: null`). Externalizing keeps exactly one instance at runtime.
//
// The UMD builds deliberately skip this — they must stay self-contained.
const externalizeContext = {
  name: "externalize-context",
  resolveId(source: string, importer?: string) {
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
};

// tsdown emits the CommonJS declarations (`.d.cts`) in a build pass of their
// own, and it leaves the config's `plugins` out of that pass. Without
// `externalizeContext` there, the declarations bundle src/v2/context.ts into a
// chunk, so the `.d.cts` files declare a second `CopilotKitCoreReact`. The class
// has private members, so a CommonJS consumer could not pass the instance from
// `@copilotkit/react-core/v2/context` to an entry typed with the other copy.
// This `inputOptions` hook adds the plugin to that pass. It edits the options
// in place and returns nothing: tsdown merges a returned object with `defu`,
// which would concatenate the plugin list with itself.
//
// `onlyFrom` limits it to the declarations of some modules. The main build
// needs that: its CommonJS declarations also serve the root `.` entry, which
// `moduleResolution: node10` reads through `types`, and node10 cannot resolve
// the `@copilotkit/react-core/v2/context` subpath (attw reports it as an
// InternalResolutionError). So that build keeps the bundled copy and only the
// `/v2/generative-ui/native` declarations, which node10 cannot reach anyway,
// import the class from `/v2/context`.
// `scripts/assert-dist-context-types.mjs` checks the result after each build.
const externalizeContextInCjsDts =
  (onlyFrom?: RegExp) =>
  (
    options: { plugins?: unknown },
    _format: unknown,
    { cjsDts }: { cjsDts: boolean },
  ) => {
    if (!cjsDts) return;
    const plugin = onlyFrom
      ? {
          name: "externalize-context-cjs-dts",
          resolveId(source: string, importer?: string) {
            if (!importer || !onlyFrom.test(importer)) return null;
            return externalizeContext.resolveId(source, importer);
          },
        }
      : externalizeContext;
    options.plugins = [plugin, options.plugins];
  };

export default defineConfig([
  {
    // `v2/generative-ui` is built here, next to `v2/index`, and not as its
    // own build. One build puts the modules that both entries use (for
    // example `generative-ui/runtime-context.ts`) in one shared chunk. A
    // separate build would inline a second copy, and its `createContext()`
    // would give a second context: `GenerativeUISurface` from the subpath
    // would not see the runtime that `CopilotKitProvider` from `/v2` sets.
    entry: {
      index: "src/v1-deprecated-compatibility.ts",
      "v2/index": "src/v2/index.ts",
      "v2/generative-ui": "src/v2/generative-ui/index.ts",
      // The DOM-free generative UI entry for React Native. It is in this
      // build for the same reason: one copy of each context.
      "v2/generative-ui/native": "src/v2/generative-ui/native.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    hooks: {
      "build:done": () => postProcessDeclarations(path.resolve("dist")),
    },
    plugins: [externalizeContext],
    inputOptions: externalizeContextInCjsDts(
      /[\\/]src[\\/]v2[\\/]generative-ui[\\/]native\.d\.ts$/,
    ),
    external: [
      "react",
      "react-dom",
      "@copilotkit/core",
      "@copilotkit/shared",
      "@copilotkit/react-core/v2/context",
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
    plugins: [externalizeContext],
    inputOptions: externalizeContextInCjsDts(),
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
  // UMD builds. Each externalized @copilotkit/* dep must be loaded as a global
  // before this bundle. Note `@copilotkit/mcp-apps-renderer/activity` -> the
  // global `CopilotKitMcpAppsRendererActivity`: the provider registers the MCP
  // Apps activity from that (bridge-free) entry, so script-tag consumers must
  // load `@copilotkit/mcp-apps-renderer/dist/activity.umd.js` before this bundle
  // (see that package's README). The ext-apps bridge itself is NOT here; it is
  // loaded lazily via dynamic import() only when an MCP App renders.
  {
    entry: {
      index: "src/v1-deprecated-compatibility.ts",
    },
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
      "@copilotkit/mcp-apps-renderer/activity",
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
        "@copilotkit/mcp-apps-renderer/activity":
          "CopilotKitMcpAppsRendererActivity",
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
      "@copilotkit/mcp-apps-renderer/activity",
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
        "@copilotkit/mcp-apps-renderer/activity":
          "CopilotKitMcpAppsRendererActivity",
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
        "use-stick-to-bottom": "useStickToBottom",
        "ts-deepmerge": "tsDeepmerge",
      };
      return options;
    },
  },
]);
