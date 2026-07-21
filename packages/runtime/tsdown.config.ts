/// <reference types="node" />
import { defineConfig } from "tsdown";
import fs from "node:fs";
import path from "node:path";

const stripRuntimeBannersFromDeclarations = (dir: string) => {
  const runtimeBanner =
    /^[ \t]*(?:require\(["']reflect-metadata["']\)|import\s+["']reflect-metadata["']);?[ \t]*\r?\n/gm;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.d\.[cm]?ts$/.test(entry.name)) {
        const declaration = fs.readFileSync(full, "utf8");
        const withoutRuntimeBanner = declaration.replace(runtimeBanner, "");
        if (withoutRuntimeBanner !== declaration) {
          fs.writeFileSync(full, withoutRuntimeBanner);
        }
      }
    }
  };

  if (fs.existsSync(dir)) walk(dir);
};

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
  hooks: {
    "build:done": () =>
      stripRuntimeBannersFromDeclarations(path.resolve("dist")),
  },
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
    "rxjs",
  ],
  exports: true,
});
