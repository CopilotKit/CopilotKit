/// <reference types="node" />
import { defineConfig } from "tsdown";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolved path to src/context.ts — used to redirect the headless build's
// relative ../context imports to the external @copilotkit/react-core/context
// package path, ensuring a shared React context instance at runtime.
const configDir = path.dirname(fileURLToPath(import.meta.url));
const contextModulePath = path.resolve(configDir, "src/context");

// Post-process the emitted declaration files. tsdown/rolldown-plugin-dts emits
// the headless re-export of the externalized context module as a relative
// `./context` import, which is invalid in ESM declarations (extensionless) and
// breaks `attw` type resolution. Rewrite it to the package subpath so it
// resolves under node16/nodenext/bundler — matching how the JS bundle
// externalizes it.
// Run from `build:done` so it processes every format's declarations on disk,
// independent of per-output plugin order (the esm `.d.mts` and cjs `.d.cts` are
// emitted in separate passes).
const postProcessDeclarations = (dir: string) => {
  const contextImport = /from\s+["']\.\.?\/context["']/g;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.d\.[cm]?ts$/.test(entry.name)) {
        const code = fs.readFileSync(full, "utf8");
        const next = code.replace(
          contextImport,
          'from "@copilotkit/react-core/context"',
        );
        if (next !== code) fs.writeFileSync(full, next);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
};

// Redirects any relative `../context` / `./context` import that resolves to
// src/context.ts onto the external `@copilotkit/react-core/context`
// package path.
//
// src/context.ts is emitted as its own entry (dist/context.*) so React
// Native can consume it without dragging in the web bundle. Any build that ALSO
// inlines it ends up running `createContext()` a second time, producing a
// distinct context instance: `CopilotKitProvider` would publish to its inlined
// copy while consumers importing from `@copilotkit/react-core/context` read
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
          id: "@copilotkit/react-core/context",
          external: true,
        };
      }
    }
    return null;
  },
};

export default defineConfig([
  {
    // `generative-ui` is built here, next to `index`, and not as its
    // own build. One build puts the modules that both entries use (for
    // example `generative-ui/runtime-context.ts`) in one shared chunk. A
    // separate build would inline a second copy, and its `createContext()`
    // would give a second context: `GenerativeUISurface` from the subpath
    // would not see the runtime that `CopilotKit` from the root sets.
    entry: {
      index: "src/index.ts",
      "generative-ui": "src/generative-ui/index.ts",
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
    external: [
      "react",
      "react-dom",
      "@copilotkit/core",
      "@copilotkit/shared",
      "@copilotkit/react-core/context",
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
        "./context": {
          import: "./dist/context.mjs",
          require: "./dist/context.cjs",
        },
        "./headless": {
          import: "./dist/headless.mjs",
          require: "./dist/headless.cjs",
        },
      }),
    },
  },
  // context is built separately into dist/ so it produces a standalone
  // file instead of being absorbed into shared chunks.
  {
    entry: {
      context: "src/context.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    external: ["react", "@copilotkit/core", "@copilotkit/shared"],
  },
  // headless: platform-agnostic hooks + CopilotKitCoreReact, used by
  // @copilotkit/react-native. All @copilotkit/* deps are external — they
  // contain no Node-only code that would break Metro. Keeping them external
  // (rather than inlining) ensures the CopilotKitCoreReact class is the same
  // nominal type as the one in context, avoiding unsafe `as unknown as` casts.
  {
    entry: {
      headless: "src/headless.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    plugins: [externalizeContext],
    external: [
      "react",
      "@ag-ui/client",
      "@ag-ui/core",
      "@copilotkit/core",
      "@copilotkit/shared",
      "@copilotkit/react-core/context",
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
    entry: ["src/index.ts"],
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
        "@copilotkit/web-inspector": "CopilotKitWebInspector",
        "@copilotkit/a2ui-renderer": "CopilotKitA2UIRenderer",
        "@copilotkit/mcp-apps-renderer/activity":
          "CopilotKitMcpAppsRendererActivity",
        "@ag-ui/client": "AgUIClient",
        "@ag-ui/core": "AgUICore",
        zod: "Zod",
        "tailwind-merge": "tailwindMerge",
        "lucide-react": "lucideReact",
        "@radix-ui/react-slot": "RadixReactSlot",
        "class-variance-authority": "classVarianceAuthority",
        clsx: "clsx",
        "@radix-ui/react-tooltip": "RadixReactTooltip",
        "@radix-ui/react-dropdown-menu": "RadixReactDropdownMenu",
        "@copilotkit/markdown-renderer": "CopilotKitMarkdownRenderer",
        "@copilotkit/markdown-renderer/react":
          "CopilotKitMarkdownRendererReact",
        "use-stick-to-bottom": "useStickToBottom",
        "ts-deepmerge": "tsDeepmerge",
      };
      return options;
    },
  },
]);
