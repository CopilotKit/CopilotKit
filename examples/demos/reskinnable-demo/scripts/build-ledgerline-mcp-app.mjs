#!/usr/bin/env node
/**
 * Builds the Ledgerline MCP app into ONE self-contained HTML file:
 *   src/skins/ledgerline/mcp-app/dist/ledgerline-app.html (gitignored)
 *
 * `src/skins/ledgerline/mcp/server.ts` serves it as the
 * `ui://ledgerline/ledgerline-app.html` resource to MCP Apps hosts (ChatGPT).
 * Hosts render it in a sandboxed iframe with no network, so React, the cards
 * (`genui/cards.tsx`, the same file the in-app chat renders) and their compiled
 * Tailwind CSS are all inlined.
 *
 * The CSS reuses the app's own token vocabulary: the `@theme inline` block is
 * read out of `src/app/globals.css` at build time, so the two cannot drift,
 * and the values come from the skin's `theme.css`.
 *
 * `pnpm dev` and `pnpm build` run it first.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skinDir = path.join(root, "src/skins/ledgerline");
const appDir = path.join(skinDir, "mcp-app");
const outFile = path.join(appDir, "dist/ledgerline-app.html");
const started = Date.now();

const js = await build({
  entryPoints: [path.join(appDir, "main.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  jsx: "automatic",
  alias: { "@": path.join(root, "src") },
  define: { "process.env.NODE_ENV": '"production"' },
  logOverride: { "unsupported-directive": "silent" },
  logLevel: "warning",
});

const globals = await readFile(path.join(root, "src/app/globals.css"), "utf8");
const themeBlock = /@theme inline \{[\s\S]*?\n\}/.exec(globals)?.[0];
if (!themeBlock)
  throw new Error(
    "build-ledgerline-mcp-app: no `@theme inline` block in src/app/globals.css",
  );

const cssSource = `@import "tailwindcss" source(none);
@import "../theme.css";
${themeBlock}
@source "./main.tsx";
@source "../genui";
@source "../components/ui.tsx";
@source "../components/receipt.tsx";
html { font-size: 15px; }
html, body {
  margin: 0;
  background: transparent;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
}
.ledgerline-app { padding: 2px 2px 6px; color: hsl(var(--ink)); }
`;
const from = path.join(appDir, "app.css");
const css = await postcss([
  tailwind({ base: skinDir, optimize: true }),
]).process(cssSource, { from });

const script = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ledgerline</title>
<style>${css.css}</style>
</head>
<body>
<div id="root"></div>
<script>${script}</script>
</body>
</html>
`;

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, html);
console.log(
  `[build-ledgerline-mcp-app] ${path.relative(root, outFile)} (${Math.round(html.length / 1024)} KB) in ${Date.now() - started}ms`,
);
