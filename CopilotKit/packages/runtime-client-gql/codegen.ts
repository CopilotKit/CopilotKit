import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "../runtime/__snapshots__/schema/schema.graphql",
  documents: ["./**/*.tsx", "./**/*.ts"],
  generates: {
    "./src/graphql/@generated/": {
      preset: "client",
      config: {
        useTypeImports: true,
        withHooks: false,
      },
      plugins: []
    },
  },
  hooks: {},
};

export default config;
