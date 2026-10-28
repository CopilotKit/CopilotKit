// Copies the live docs content from showcase/shell-docs into this app,
// unchanged, so pages keep their docs.copilotkit.ai URLs. shell-docs still
// serves production and stays the source of truth until the cut-over:
// edit content there, then re-run `npm run sync-content`.
//
//   shell-docs/src/content/*        -> content/live/*  (mirrored, stale files removed)
//   shell-docs/public/{images,logos,videos} -> public/*  (added; files this app already has win)
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const shellDocs = join(app, "..", "shell-docs");

const contentFrom = join(shellDocs, "src", "content");
const contentTo = join(app, "content", "live");
rmSync(contentTo, { recursive: true, force: true });
cpSync(contentFrom, contentTo, { recursive: true });

// shell-docs never runs a page's imports: it drops them and resolves every
// component by name from its MDX registry (`stripLeadingImports` in
// shell-docs' docs-render.tsx). Do the same, so an import that only ever
// worked as documentation can't break the build. Snippet imports (`.mdx`)
// stay, since snippets are real content. A blank line follows the imports so
// MDX doesn't read the next line as part of them.
for (const file of readdirSync(contentTo, { recursive: true })) {
  if (!/\.mdx?$/.test(file)) continue;
  const path = join(contentTo, file);
  const src = readFileSync(path, "utf8");
  const out = stripImports(src);
  if (out !== src) writeFileSync(path, out);
}

function stripImports(source) {
  const out = [];
  let fence = null;
  let pending = null; // a multi-line import being read
  for (const line of source.split("\n")) {
    const marker = line.match(/^\s*(```+|~~~+)/)?.[1];
    if (marker && !pending) {
      if (!fence) fence = marker;
      else if (line.trim().startsWith(fence)) fence = null;
    }
    if (fence) {
      out.push(line);
      continue;
    }
    if (pending) {
      pending.push(line);
      if (/\bfrom\s+["'][^"']+["']\s*;?\s*$/.test(line)) {
        if (isSnippet(pending.join("\n"))) out.push(...pending, "");
        pending = null;
      }
      continue;
    }
    if (/^import\b/.test(line)) {
      const complete =
        /\bfrom\s+["'][^"']+["']\s*;?\s*$/.test(line) ||
        /^import\s+["'][^"']+["']\s*;?\s*$/.test(line);
      if (!complete) pending = [line];
      else if (isSnippet(line)) out.push(line, "");
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/^(import .+\n)\n(?=import )/gm, "$1");
}

function isSnippet(statement) {
  return /from\s+["'][^"']+\.mdx?["']/.test(statement);
}

for (const dir of ["images", "logos", "videos"]) {
  const from = join(shellDocs, "public", dir);
  if (!existsSync(from)) continue;
  cpSync(from, join(app, "public", dir), {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
}

const count = (dir) =>
  readdirSync(dir, { recursive: true }).filter((f) => /\.mdx?$/.test(f)).length;
console.log(`[sync-content] ${count(contentTo)} pages -> content/live`);
