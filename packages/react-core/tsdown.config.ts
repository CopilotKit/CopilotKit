import { defineConfig } from "tsdown";
import path from "path";

// Resolved path to src/v2/context.ts — used to redirect the headless build's
// relative ../context imports to the external @copilotkit/react-core/v2/context
// package path, ensuring a shared React context instance at runtime.
const contextModulePath = path.resolve(import.meta.dirname, "src/v2/context");

export default defineConfig([
  {
    entry: ["src/index.tsx", "src/v2/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    external: [
      "react",
      "react-dom",
      "@copilotkit/core",
      "@copilotkit/shared",
      "@copilotkit/web-inspector",
      "@copilotkit/a2ui-renderer",
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
    target: "es2018",
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
    codeSplitting: false,
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
    target: "es2018",
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
    codeSplitting: false,
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
