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
      "@copilotkit/shared",
      "urql",
      "@urql/core",
      "graphql",
      "@graphql-typed-document-node/core",
      "untruncate-json",
    ],
    outputOptions(options) {
      options.codeSplitting = false;
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
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
