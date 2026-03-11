import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/v2/index.ts", "src/langgraph.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  banner: ({ format, fileName }) => {
    // tsdown/rolldown reorders bare side-effect imports to the end of the entry chunk,
    // breaking type-graphql which needs reflect-metadata at load time.
    // The _virtual/_rolldown/runtime banner propagates to all output files per format,
    // ensuring reflect-metadata is always the first thing that runs.
    if (fileName.includes("_virtual/_rolldown/runtime")) {
      return format === "cjs"
        ? 'require("reflect-metadata");'
        : 'import "reflect-metadata";';
    }
  },
  external: [
    "@ag-ui/langgraph",
    "@langchain/core",
    "@langchain/openai",
    "@langchain/aws",
    "@langchain/community",
    "@langchain/google-gauth",
    "@langchain/langgraph-sdk",
    "langchain",
    "@anthropic-ai/sdk",
    "groq-sdk",
    "@whatwg-node/fetch",
    "@whatwg-node/server",
  ],
  exports: true,
});
