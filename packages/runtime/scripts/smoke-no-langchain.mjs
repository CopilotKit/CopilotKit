#!/usr/bin/env node
/**
 * Smoke test: verify the built `@copilotkit/runtime` root barrel contains
 * zero references to `@langchain/*` or `langchain` in its transitive
 * module graph.
 *
 * The runtime claims `@langchain/core` (and friends) is an optional peer.
 * That claim is true only if importing the root barrel does not pull
 * langchain into the module graph at load time. Since 1.58.0 moved the
 * LangChain-coupled adapters to the `@copilotkit/runtime/langchain`
 * subexport, the root must stay clean.
 *
 * This walker traverses the dist output starting at `index.mjs` and
 * `index.cjs`, follows local relative imports, and fails if any reachable
 * file contains a `@langchain/*` import or a `require/import "langchain..."`.
 *
 * Run via `pnpm nx run @copilotkit/runtime:smoke-no-langchain`.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, "..", "dist");

// We walk the ESM output only. The CJS output (`*.cjs`) is produced from
// the same source, so a clean ESM graph guarantees a clean CJS graph at
// the top level. ESM also has the property that `import` is always
// top-level, which lets us distinguish eager imports from lazy `require()`
// calls inside function bodies (e.g. Ollama uses a lazy `require` for
// `@langchain/community/llms/ollama`, which is fine and explicitly out of
// scope for the 1.58.0 root-barrel decoupling).
const ROOT_ENTRIES = ["index.mjs"];

// Matches ES `import ... from "@langchain/..."` or `import "@langchain/..."`.
// Only top-level imports in ESM. Does not match `require()` (which can be
// lazy, inside method bodies — that's the Ollama case we need to allow).
const LANGCHAIN_RE =
  /(?:from\s+["']|import\s+["'])(@langchain\/[^"']+|langchain(?:\/[^"']+)?)["']/;

// Captures local relative ES imports so the walker can follow them.
const LOCAL_IMPORT_RE = /(?:from\s+["']|import\s+["'])(\.\.?\/[^"']+)["']/g;

const FILE_EXTENSIONS = ["", ".mjs", ".js"];

function resolveLocal(fromFile, relPath) {
  const baseDir = path.dirname(fromFile);
  const direct = path.resolve(baseDir, relPath);
  for (const ext of FILE_EXTENSIONS) {
    const candidate = direct + ext;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this extension, try next
    }
  }
  // Try as a directory with index.mjs
  const candidate = path.join(direct, "index.mjs");
  try {
    if (statSync(candidate).isFile()) return candidate;
  } catch {
    // not a directory, skip
  }
  return null;
}

const visited = new Set();
const violations = [];

function walk(file) {
  if (visited.has(file)) return;
  visited.add(file);

  const content = readFileSync(file, "utf8");

  if (LANGCHAIN_RE.test(content)) {
    const match = content.match(LANGCHAIN_RE);
    violations.push({
      file: path.relative(distRoot, file),
      reference: match[1],
    });
  }

  for (const match of content.matchAll(LOCAL_IMPORT_RE)) {
    const resolved = resolveLocal(file, match[1]);
    if (resolved) walk(resolved);
  }
}

console.log(`smoke-no-langchain: walking root barrel from ${distRoot}`);

for (const entry of ROOT_ENTRIES) {
  const entryPath = path.join(distRoot, entry);
  try {
    statSync(entryPath);
  } catch {
    console.error(`smoke-no-langchain: missing ${entry} — run build first`);
    process.exit(2);
  }
  walk(entryPath);
}

console.log(`smoke-no-langchain: visited ${visited.size} files`);

if (violations.length > 0) {
  console.error(
    `smoke-no-langchain: FAIL — ${violations.length} langchain reference(s) found in the root barrel:`,
  );
  for (const v of violations) {
    console.error(`  ${v.file} -> ${v.reference}`);
  }
  console.error(
    `\nThe root barrel must not import @langchain/* or langchain. ` +
      `LangChain-coupled adapters live in @copilotkit/runtime/langchain. ` +
      `Move the offending re-export into src/langchain.ts (the subexport) ` +
      `and add a throw-on-construction shim in src/lib/index.ts.`,
  );
  process.exit(1);
}

console.log(
  `smoke-no-langchain: PASS — root barrel is free of @langchain/* and langchain references`,
);
