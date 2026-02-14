import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/v2/index.ts", "src/langgraph.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
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
