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
      "@copilotkitnext/core",
      "@copilotkitnext/react",
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
      "@copilotkit/shared",
      "@copilotkit/runtime-client-gql",
      "@copilotkitnext/core",
      "@copilotkitnext/react",
      "@ag-ui/client",
      "zod",
    ],
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "react-dom": "ReactDOM",
        "@copilotkit/shared": "CopilotKitShared",
        "@copilotkit/runtime-client-gql": "CopilotKitRuntimeClientGQL",
        "@copilotkitnext/core": "CopilotKitNextCore",
        "@copilotkitnext/react": "CopilotKitNextReact",
        "@ag-ui/client": "AgUIClient",
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
      "@copilotkit/shared",
      "@copilotkit/runtime-client-gql",
      "@copilotkitnext/core",
      "@copilotkitnext/react",
      "@ag-ui/client",
      "zod",
    ],
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "react-dom": "ReactDOM",
        "@copilotkit/shared": "CopilotKitShared",
        "@copilotkit/runtime-client-gql": "CopilotKitRuntimeClientGQL",
        "@copilotkitnext/core": "CopilotKitNextCore",
        "@copilotkitnext/react": "CopilotKitNextReact",
        "@ag-ui/client": "AgUIClient",
        zod: "Zod",
      };
      return options;
    },
  },
]);
