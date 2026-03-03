import { defineConfig } from "tsdown";

const isWatch = process.argv.includes("--watch");

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: !isWatch,
    sourcemap: true,
    clean: !isWatch,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    external: ["react", "react-dom"],
    alias: {
      "@": "./src",
    },
    exports: {
      customExports: (exports) => ({
        ...exports,
        "./styles.css": "./dist/styles.css",
      }),
    },
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitNextReact",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: [
      "react",
      "react-dom",
      "@copilotkitnext/core",
      "@copilotkitnext/shared",
      "@copilotkitnext/web-inspector",
      "@ag-ui/client",
      "@ag-ui/core",
      "zod",
    ],
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "react-dom": "ReactDOM",
        "react/jsx-runtime": "ReactJsxRuntime",
        "@copilotkitnext/core": "CopilotKitNextCore",
        "@copilotkitnext/shared": "CopilotKitNextShared",
        "@copilotkitnext/web-inspector": "CopilotKitNextWebInspector",
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
