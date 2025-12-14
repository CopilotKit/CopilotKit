import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  ...options,
  entry: ["src/index.ts", "src/v2/index.ts", "src/langgraph.ts"],
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  external: [
    // Externalize AG-UI LangGraph integration
    "@ag-ui/langgraph",
    // Externalize all LangChain packages to prevent bundling Node.js-only dependencies
    // like @aws-sdk/* which cause browser build failures (see issue #2731)
    "@langchain/core",
    "@langchain/openai",
    "@langchain/aws",
    "@langchain/community",
    "@langchain/google-gauth",
    "@langchain/langgraph-sdk",
    "langchain",
    // Externalize AWS SDK packages that may be pulled in transitively
    /^@aws-sdk\/.*/,
    // Externalize other optional peer dependencies
    "@anthropic-ai/sdk",
    "groq-sdk",
  ],
  sourcemap: true,
  exclude: [
    "**/*.test.ts", // Exclude TypeScript test files
    "**/*.test.tsx", // Exclude TypeScript React test files
    "**/__tests__/*", // Exclude any files inside a __tests__ directory
  ],
  treeshake: true,
  // Disable code splitting so each entry point is fully independent
  // This prevents @ag-ui/langgraph from being pulled into index.mjs via shared chunks
  splitting: false,
}));
