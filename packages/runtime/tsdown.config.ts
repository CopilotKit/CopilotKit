import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/v2/index.ts",
    "src/v2/express.ts",
    "src/v2/hono.ts",
    "src/v2/node.ts",
    "src/langgraph.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  // tsdown/rolldown reorders bare side-effect imports to the end of the entry
  // chunk, breaking type-graphql, which needs reflect-metadata at load time. So
  // every JS output gets reflect-metadata prepended, guaranteeing it runs first.
  //
  // Return an OBJECT, not a string. tsdown routes an object banner by chunk kind
  // (`js` / `dts` / `css`) but applies a string banner to *every* chunk, including
  // declarations -- which put `require("reflect-metadata");` at line 1 of all 87
  // published `.d.cts` files and cost consumers 71 x TS1036 "Statements are not
  // allowed in ambient contexts" under `skipLibCheck: false` (OSS-899).
  //
  // Nor is this keyed off `fileName` any more. tsdown's `resolveChunkAddon`
  // reassigns its own closure variable on the first call, so a function banner is
  // evaluated once and its result reused for every later chunk -- meaning a
  // fileName condition silently decided the banner for the whole build based on
  // whichever chunk happened to be emitted first. Keying on `format` alone is
  // order-independent, and `format` is fixed per build.
  banner: ({ format }) => ({
    js:
      format === "cjs"
        ? 'require("reflect-metadata");'
        : 'import "reflect-metadata";',
  }),
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
    "rxjs",
  ],
  exports: true,
});
