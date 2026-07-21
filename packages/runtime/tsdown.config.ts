/// <reference types="node" />
import { defineConfig } from "tsdown";
import fs from "node:fs";
import path from "node:path";

const finalizeDeclarations = (dir: string) => {
  const runtimeBanner =
    /^[ \t]*(?:require\(["']reflect-metadata["']\)|import\s+["']reflect-metadata["']);?[ \t]*\r?\n/gm;
  const unusedRolldownHelper =
    /^import \{ __exportAll, __reExport \} from ["'][^"']+\/_virtual\/_rolldown\/runtime\.[cm]js["'];\r?\n/gm;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.d\.[cm]?ts$/.test(entry.name)) {
        const declaration = fs.readFileSync(full, "utf8");
        const finalized = declaration
          .replace(runtimeBanner, "")
          .replace(unusedRolldownHelper, "");
        if (finalized !== declaration) {
          fs.writeFileSync(full, finalized);
        }
      }
    }
  };

  if (!fs.existsSync(dir)) return;
  walk(dir);

  const compatibilityDir = path.join(dir, "compat");
  fs.mkdirSync(compatibilityDir, { recursive: true });
  fs.copyFileSync(
    path.resolve("src/compat/langgraph-sdk.d.ts"),
    path.join(compatibilityDir, "langgraph-sdk.d.ts"),
  );

  for (const extension of ["d.mts", "d.cts"] as const) {
    const agentDeclaration = path.join(
      dir,
      "lib/runtime/agent-integrations/langgraph",
      `agent.${extension}`,
    );
    const reference =
      '/// <reference path="../../../../compat/langgraph-sdk.d.ts" />\n';
    const declaration = fs.readFileSync(agentDeclaration, "utf8");
    if (!declaration.startsWith(reference)) {
      fs.writeFileSync(agentDeclaration, reference + declaration);
    }
  }
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
    "build:done": () => finalizeDeclarations(path.resolve("dist")),
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
