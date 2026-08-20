import { defineConfig } from "tsdown";
import fs from "node:fs";
import path from "node:path";

// The source tree makes the legacy implementation explicit under
// src/v1-deprecated, but
// the published package must retain its historical dist/* layout. Runtime uses
// an unbundled build, so flatten the implementation-only v1-deprecated segment
// after emit and update emitted relative imports to match. No deprecated source
// directory is added as a public package export.
function preservePublishedV1Layout(distDir: string) {
  const v1DeprecatedDir = path.join(distDir, "v1-deprecated");
  if (!fs.existsSync(v1DeprecatedDir)) return;
  const movedFiles = new Map<string, string>();

  const moveTree = (source: string, destination: string) => {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        moveTree(from, to);
      } else {
        if (fs.existsSync(to)) {
          throw new Error(
            `Refusing to overwrite published build output: ${to}`,
          );
        }
        fs.renameSync(from, to);
        movedFiles.set(to, from);
      }
    }
  };

  moveTree(v1DeprecatedDir, distDir);
  fs.rmSync(v1DeprecatedDir, { recursive: true, force: true });

  const rewriteImports = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        rewriteImports(file);
      } else if (!entry.name.endsWith(".map")) {
        const source = fs.readFileSync(file, "utf8");
        const originalFile = movedFiles.get(file);
        const output = originalFile
          ? source.replace(
              /((?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*))(["'])(\.\.?\/[^"']+)\2/g,
              (match, prefix: string, quote: string, specifier: string) => {
                const originalTarget = path.resolve(
                  path.dirname(originalFile),
                  specifier,
                );
                const relativeToV1Deprecated = path.relative(
                  v1DeprecatedDir,
                  originalTarget,
                );
                const movedTarget =
                  relativeToV1Deprecated === "" ||
                  (!relativeToV1Deprecated.startsWith(`..${path.sep}`) &&
                    relativeToV1Deprecated !== "..")
                    ? path.join(distDir, relativeToV1Deprecated)
                    : originalTarget;
                let relocated = path
                  .relative(path.dirname(file), movedTarget)
                  .split(path.sep)
                  .join("/");
                if (!relocated.startsWith(".")) relocated = `./${relocated}`;
                return `${prefix}${quote}${relocated}${quote}`;
              },
            )
          : source.replace(/(["'])((?:\.\.\/)+|\.\/)v1-deprecated\//g, "$1$2");
        if (source !== output) fs.writeFileSync(file, output);
      }
    }
  };
  rewriteImports(distDir);
}

export default defineConfig({
  entry: {
    index: "src/v1-deprecated-compatibility.ts",
    "v2/index": "src/v2/index.ts",
    "v2/express": "src/v2/express.ts",
    "v2/hono": "src/v2/hono.ts",
    "v2/node": "src/v2/node.ts",
    langgraph: "src/v1-deprecated/langgraph.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  hooks: {
    "build:done": () => preservePublishedV1Layout(path.resolve("dist")),
  },
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
