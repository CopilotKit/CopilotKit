import type { CodegenConfig } from "@graphql-codegen/cli";
import path from "node:path";

const schema = path.resolve(__dirname, "../runtime/__snapshots__/schema/schema.graphql");

const config: CodegenConfig = {
  schema,
  documents: ["src/graphql/definitions/**/*.{ts,tsx}"],
  generates: {
    "./src/graphql/@generated/": {
      preset: "client",
      config: {
        useTypeImports: true,
        withHooks: false,
      },
      plugins: [],
    },
  },
  hooks: {},
};

export default config;
