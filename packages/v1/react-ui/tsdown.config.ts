import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.tsx"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    external: [
      "react",
      "react-dom",
      "@copilotkitnext/core",
      "@copilotkitnext/react",
    ],
    exports: {
      customExports: (exports) => ({
        ...exports,
        "./styles.css": "./dist/index.css",
      }),
    },
  },
  {
    entry: ["src/index.tsx"],
    format: ["umd"],
    globalName: "CopilotKitReactUI",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: [
      "react",
      "react-dom",
      "@copilotkit/react-core",
      "@copilotkit/shared",
      "@copilotkit/runtime-client-gql",
    ],
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "react-dom": "ReactDOM",
        "react/jsx-runtime": "ReactJsxRuntime",
        "@copilotkit/react-core": "CopilotKitReactCore",
        "@copilotkit/shared": "CopilotKitShared",
        "@copilotkit/runtime-client-gql": "CopilotKitRuntimeClientGQL",
        "@headlessui/react": "HeadlessUIReact",
        "react-markdown": "ReactMarkdown",
        "react-syntax-highlighter": "ReactSyntaxHighlighter",
        "remark-gfm": "remarkGfm",
        "remark-math": "remarkMath",
        "rehype-raw": "rehypeRaw",
      };
      return options;
    },
  },
]);
