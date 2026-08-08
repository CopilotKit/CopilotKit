// Relative regression signal for what an RN app bundles when it imports the
// headless entry. Mirrors react-core's scripts/measure-copilotchat.mjs: drive
// esbuild over a synthetic entry, sum the gzipped output, print to the job
// summary. This is NOT a production Metro figure — it is comparable across PRs.
//
// Why this exists: a single import of @copilotkit/react-core/v2 (instead of
// /v2/headless) would multiply this number, because Metro does not tree-shake
// (issue #4893). The structural guards fail first; this makes the magnitude
// visible if one is ever weakened.
//
// Resolution note: the synthetic entry is fed via esbuild `stdin` with
// `resolveDir` set to this package's root (exactly as measure-copilotchat.mjs
// does), so `@copilotkit/react-native/headless` resolves through the workspace
// node_modules. Writing the entry to a temp dir would break resolution — the
// temp dir has no node_modules link to the monorepo.
//
// TEMPORARY — REVISIT: `useRenderToolCall` is missing from the import list
// only because the RN headless entry does not export it *yet*. The render-tool
// convergence (this same branch) adds that export; once RN's `src/headless.ts`
// re-exports `useRenderToolCall`, add it back to the import list below and
// re-baseline the reported number. Do NOT treat its absence as a design fact:
// including it today breaks the build (the export does not exist yet), which is
// the only reason it is left out. The symbols below are the currently-exported
// lean headless API a custom-UI consumer imports.
//
// `platform: "browser"` + `target: "es2022"` mirror measure-copilotchat.mjs.
// `platform: "neutral"` cannot resolve deps that ship only conditional
// `exports` (e.g. untruncate-json, chalk), and browser resolution is the
// closest esbuild analogue to how Metro resolves an RN app's JS graph.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  stdin: {
    contents: `import { CopilotKitProvider, useAgent, useFrontendTool, useRenderTool, useComponent } from "@copilotkit/react-native/headless";
console.log(CopilotKitProvider, useAgent, useFrontendTool, useRenderTool, useComponent);`,
    resolveDir: pkgRoot,
    loader: "js",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  minify: true,
  external: ["react", "react-native", "react/jsx-runtime"],
  logLevel: "silent",
});

const total = result.outputFiles.reduce((sum, f) => sum + gzipSync(f.contents).length, 0);

const kb = (total / 1024).toFixed(1);
console.log(`@copilotkit/react-native/headless (gzip, esbuild signal): ${kb} kB`);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### react-native headless import size\n\n\`${kb} kB\` gzipped (esbuild regression signal, not a Metro figure)\n`,
  );
}
