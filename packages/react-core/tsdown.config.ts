import { defineConfig } from "tsdown";

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
      customExports: (exports) => {
        // Nest types inside each condition so ESM gets .d.mts and CJS gets .d.cts
        const nestTypes = (
          entry: Record<string, string>,
          dtsBase: string,
        ): Record<string, unknown> => {
          const result: Record<string, unknown> = {};
          for (const [condition, value] of Object.entries(entry)) {
            if (condition === "import") {
              result[condition] = {
                types: `${dtsBase}.d.mts`,
                default: value,
              };
            } else if (condition === "require") {
              result[condition] = {
                types: `${dtsBase}.d.cts`,
                default: value,
              };
            } else {
              result[condition] = value;
            }
          }
          return result;
        };
        return {
          ".": nestTypes(
            exports["."] as Record<string, string>,
            "./dist/index",
          ),
          "./v2": nestTypes(
            exports["./v2"] as Record<string, string>,
            "./dist/v2/index",
          ),
          ...Object.fromEntries(
            Object.entries(exports).filter(([k]) => k !== "." && k !== "./v2"),
          ),
          "./v2/styles.css": "./dist/v2/index.css",
        };
      },
    },
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
