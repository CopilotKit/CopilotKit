import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  ...options,
  entry: ["src/**/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  external: [
    // Server frameworks - can't bundle due to dynamic requires
    "express",

    // TypeGraphQL ecosystem - requires global reflect-metadata initialization
    "reflect-metadata",
    "type-graphql",
    "class-transformer",
    "class-validator",

    // GraphQL ecosystem - module singleton patterns
    "graphql",
    "graphql-yoga",
    "graphql-scalars",
    "@graphql-yoga/plugin-defer-stream",

    // vnext packages - must be shared with consuming app
    "@copilotkitnext/agent",
    "@copilotkitnext/runtime",

    // LangChain ecosystem - has native bindings and complex resolution
    "langchain",
    /^@langchain\//,  // Matches all @langchain/* packages

    // AI SDKs - may have native dependencies
    "openai",
    "@anthropic-ai/sdk",
    "groq-sdk",

    // State management - exact version pinning required (7.8.1)
    "rxjs",

    // Validation - should match app's version
    "zod",

    // Logging
    "pino",
    "pino-pretty",
  ],
  sourcemap: true,
  exclude: [
    "**/*.test.ts", // Exclude TypeScript test files
    "**/*.test.tsx", // Exclude TypeScript React test files
    "**/__tests__/*", // Exclude any files inside a __tests__ directory
  ],
}));
