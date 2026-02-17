import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    external: ["react", "@graphql-typed-document-node/core"],
    exclude: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/*"],
    exports: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitRuntimeClientGQL",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: [
      "react",
      "@copilotkit/runtime",
      "@copilotkit/shared",
      "urql",
      "@urql/core",
      "graphql",
      "@graphql-typed-document-node/core",
      "untruncate-json",
    ],
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "@copilotkit/runtime": "CopilotKitRuntime",
        "@copilotkit/shared": "CopilotKitShared",
        urql: "Urql",
        "@urql/core": "UrqlCore",
        graphql: "GraphQL",
        "@graphql-typed-document-node/core": "GraphQLTypedDocumentNode",
        "untruncate-json": "untruncateJson",
      };
      return options;
    },
  },
]);
