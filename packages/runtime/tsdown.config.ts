import { defineConfig } from "tsdown";
import fs from "node:fs";
import path from "node:path";

const runtimeFormats: Array<"esm" | "cjs"> = ["esm", "cjs"];

// The source tree makes the legacy implementation explicit under
// src/v1-deprecated, but
// the published package must retain its historical dist/* layout. Runtime uses
// an unbundled build, so flatten the implementation-only v1-deprecated segment
// after emit and update emitted relative imports to match. No deprecated source
// directory is added as a public package export.
function preservePublishedV1Layout(distDir: string) {
  const v1DeprecatedDir = path.join(distDir, "v1-deprecated");
  if (!fs.existsSync(v1DeprecatedDir)) {
    throw new Error(
      `Missing required deprecated v1 build output directory: ${v1DeprecatedDir}`,
    );
  }
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

export function createPublishedV1LayoutBuildDoneHook(
  distDir: string,
  expectedFormats: readonly string[],
) {
  const expected = new Set(expectedFormats);
  if (expected.size === 0 || expected.size !== expectedFormats.length) {
    throw new Error("Expected build formats must be non-empty and unique");
  }
  const completed = new Set<string>();

  return ({ options }: { options: { format: string } }) => {
    // tsdown accepts `esm` in user config but normalizes it to `es` in the
    // resolved hook context.
    const format = options.format === "es" ? "esm" : options.format;
    if (!expected.has(format)) {
      throw new Error(`Unexpected runtime build format: ${format}`);
    }
    if (completed.has(format)) {
      throw new Error(
        `Runtime build format completed twice before its peers: ${format}`,
      );
    }

    completed.add(format);
    if (completed.size < expected.size) return;

    completed.clear();
    preservePublishedV1Layout(distDir);
  };
}

// tsdown expands the format array into concurrent configs and shallow-copies
// this hook into each one. Sharing one closure ensures the published layout is
// mutated once, only after every format completes, then resets for watch cycles.
const publishV1LayoutAfterAllFormats = createPublishedV1LayoutBuildDoneHook(
  path.resolve("dist"),
  runtimeFormats,
);

export default defineConfig({
  entry: {
    index: "src/v1-deprecated-compatibility.ts",
    "v2/index": "src/v2/index.ts",
    "v2/express": "src/v2/express.ts",
    "v2/hono": "src/v2/hono.ts",
    "v2/node": "src/v2/node.ts",
    langgraph: "src/v1-deprecated/langgraph.ts",
  },
  format: runtimeFormats,
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  hooks: {
    "build:done": publishV1LayoutAfterAllFormats,
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
