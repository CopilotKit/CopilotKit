// Measures a relative bundle-regression signal for `CopilotChat`: the total
// gzipped JS that bundling `{ CopilotChat }` from `@copilotkit/react-core/v2`
// produces (entry + all code-split chunks).
//
// IMPORTANT — this is a relative regression signal, NOT a production figure.
// It uses esbuild; a real consumer (Vite/Next/webpack) splits eager-vs-lazy
// differently and reports different absolute numbers. Its value is consistency
// across PRs: the same script every PR, so a change that grows CopilotChat's
// JS shows up.
//
// Why a custom esbuild script instead of size-limit: CopilotChat's graph pulls
// `katex/dist/katex.min.css`, whose url() font refs crash size-limit's esbuild
// preset (which exposes no loader/config hook). Driving esbuild directly lets
// us stub CSS/fonts to "empty" (we measure JS, not CSS). react/react-dom are
// external — a host React app already ships them.
//
// Run: `node scripts/measure-copilotchat.mjs` (after `nx run react-core:build`).
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_EXTERNAL = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
  "react-dom/server",
];

const EMPTY_LOADERS = {
  ".css": "empty",
  ".woff": "empty",
  ".woff2": "empty",
  ".ttf": "empty",
  ".eot": "empty",
  ".svg": "empty",
};

/**
 * Bundle `export { CopilotChat } from <entryModule>` with esbuild (minified,
 * code-split, react/react-dom external, CSS/fonts stubbed empty) and return
 * the summed gzip byte count across all output chunks.
 *
 * @param {object} options
 * @param {string} options.entryModule - Absolute path to the module that exports CopilotChat.
 * @param {string} options.pkgRoot - Working directory for esbuild resolution and the (in-memory) outdir.
 * @param {string[]} [options.external] - External specifiers; defaults to react/react-dom subpaths.
 * @param {Record<string, string>} [options.loader] - esbuild loader map; defaults to stubbing CSS/fonts.
 * @returns {Promise<{ totalBytes: number, outputCount: number }>}
 */
export async function measureBundle({
  entryModule,
  pkgRoot,
  external = DEFAULT_EXTERNAL,
  loader = EMPTY_LOADERS,
}) {
  const result = await build({
    stdin: {
      contents: `export { CopilotChat } from ${JSON.stringify(entryModule)};`,
      resolveDir: pkgRoot,
      loader: "js",
    },
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    outdir: path.join(pkgRoot, ".size-headline-tmp"),
    write: false,
    external,
    loader,
    logLevel: "silent",
  });
  let totalBytes = 0;
  for (const file of result.outputFiles) {
    totalBytes += gzipSync(Buffer.from(file.contents)).length;
  }
  return { totalBytes, outputCount: result.outputFiles.length };
}

// CLI entry — only runs when invoked directly, so importing this module from
// tests doesn't perform a real build at module-load time.
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file://${path.resolve(process.argv[1] ?? "")}`;
if (isMain) {
  const pkgRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const entryModule = path.join(pkgRoot, "dist/v2/index.mjs");
  const { totalBytes } = await measureBundle({ entryModule, pkgRoot });
  if (totalBytes === 0) {
    console.error("measure-copilotchat: esbuild produced no output");
    process.exit(1);
  }
  const mb = (totalBytes / 1024 / 1024).toFixed(2);
  const caption =
    "esbuild relative regression signal — not a production Vite/Next figure";
  console.log(`CopilotChat total bundled JS: ${mb} MB gzip (${caption})`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Bundle regression signal — react-core CopilotChat\n\n` +
        `- **CopilotChat total bundled JS: ${mb} MB gzip**\n` +
        `- _${caption}_\n`,
    );
  }
}
