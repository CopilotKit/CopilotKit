import { defineConfig } from "tsdown";

const sharedExternals = [
  "react",
  "react-dom",
  "@copilotkit/core",
  "@copilotkit/shared",
  "@copilotkit/web-inspector",
  "@copilotkit/a2ui-renderer",
  "@copilotkit/runtime-client-gql",
  "@ag-ui/client",
  "@ag-ui/core",
  "rxjs",
  "zod",
  "react-markdown",
  "streamdown",
  "ts-deepmerge",
  /\.css$/,
];

export default defineConfig([
  // =========================
  // ESM + CJS BUILD
  // =========================
  {
    entry: ["src/index.tsx", "src/v2/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",

    external: [
      ...sharedExternals,
    ],

    exports: {
      customExports: (exports) => ({
        ...exports,
        "./v2/styles.css": "./dist/v2/index.css",
      }),
    },
  },

  // =========================
  // UMD BUILD (V1)
  // =========================
  {
    entry: ["src/index.tsx"],
    format: ["umd"],
    globalName: "CopilotKitReactCore",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",

    external: [
      ...sharedExternals,
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
        zod: "Zod",
      };

      return options;
    },
  },

  // =========================
  // UMD BUILD (V2)
  // =========================
  {
    entry: ["src/v2/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitReactCoreV2",
    sourcemap: true,
    target: "es2018",
    outDir: "dist/v2",

    external: [
      ...sharedExternals,
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

        // UI libs
        "tailwind-merge": "tailwindMerge",
        "lucide-react": "lucideReact",
        "@radix-ui/react-slot": "RadixReactSlot",
        "@radix-ui/react-tooltip": "RadixReactTooltip",
        "@radix-ui/react-dropdown-menu": "RadixReactDropdownMenu",
        "class-variance-authority": "classVarianceAuthority",
        clsx: "clsx",

        // css/libs
        "katex/dist/katex.min.css": "katexCss",
        useStickToBottom: "useStickToBottom",
        LitLabsReact: "LitLabsReact",
      };

      return options;
    },
  },
]);