import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/v2/index.ts", "src/langgraph.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  banner: ({ format }) => {
    // type-graphql needs reflect-metadata at load time.
    return format === "cjs"
      ? 'require("reflect-metadata");'
      : 'import "reflect-metadata";';
  },
  // Optional peer deps that may not be installed — keep external.
  // They're only loaded via dynamic require() inside adapter methods.
  external: [
    "@ag-ui/langgraph",
    "@anthropic-ai/sdk",
    "@langchain/aws",
    "@langchain/community",
    "@langchain/google-gauth",
    "@langchain/langgraph-sdk",
    "@langchain/openai",
    "groq-sdk",
    /^langchain/,
  ],
  // Bundle direct dependencies so consumers don't need to resolve them.
  // Without this, tsdown auto-externalizes dependencies/peerDependencies,
  // which breaks Vercel + pnpm strict.
  noExternal: [
    /^@ag-ui\//,
    /^@ai-sdk\//,
    /^@copilotkit\//,
    /^@copilotkitnext\//,
    /^@graphql-yoga\//,
    /^@hono\//,
    /^@langchain\/core/,
    /^@scarf\//,
    /^@whatwg-node\//,
    "ai",
    "class-transformer",
    "class-validator",
    /^graphql/,
    "hono",
    "openai",
    "partial-json",
    "pino",
    "pino-pretty",
    "reflect-metadata",
    "rxjs",
    "type-graphql",
    "zod",
  ],
  // Acknowledge that we intentionally bundle dependencies into the output.
  // Without this, tsdown errors when it detects deps in the bundle.
  inlineOnly: false,
  exports: true,
});
