/**
 * Post-build script:
 * 1. Copies .d.cts → .d.ts and .d.cts.map → .d.ts.map so that consumers
 *    on legacy moduleResolution ("node") can resolve types.
 * 2. Strips inline `type` modifiers from export statements in ALL .d.ts,
 *    .d.cts, and .d.mts files so bundlers that accidentally parse them
 *    as JavaScript don't choke on the TS-only syntax.
 *
 *    `export { type X, Y }` → `export { X, Y }`
 *
 *    In declaration files the modifier is redundant — TypeScript infers
 *    type-ness from the declarations themselves.
 *
 * Usage: node scripts/copy-dts.mjs [dir]
 *   dir defaults to ./dist
 */

import { readdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve(process.argv[2] || "dist");

/**
 * Strip inline `type` modifiers from named export statements.
 *
 *   export { type Foo, type Bar, Baz }  →  export { Foo, Bar, Baz }
 *
 * Only touches `type` that appears as an inline modifier inside
 * `export { ... }` blocks — not `export type { ... }` (full type-only
 * exports) which are already valid in both TS and JS contexts.
 */
function stripExportTypeModifiers(source) {
  return source.replace(
    /\bexport\s*\{[^}]+\}/g,
    (exportBlock) => exportBlock.replace(/([{,]\s*)type\s+(?!as\b)(?=\w)/g, "$1"),
  );
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (entry.endsWith(".d.cts")) {
      // Copy .d.cts → .d.ts for legacy moduleResolution
      const target = full.replace(/\.d\.cts$/, ".d.ts");
      copyFileSync(full, target);
    } else if (entry.endsWith(".d.cts.map")) {
      const target = full.replace(/\.d\.cts\.map$/, ".d.ts.map");
      copyFileSync(full, target);
    }
  }
}

function stripTypeModifiersInDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      stripTypeModifiersInDir(full);
    } else if (/\.d\.(ts|cts|mts)$/.test(entry)) {
      const before = readFileSync(full, "utf8");
      const after = stripExportTypeModifiers(before);
      if (after !== before) {
        writeFileSync(full, after);
      }
    }
  }
}

// Step 1: copy .d.cts → .d.ts
walk(distDir);

// Step 2: strip inline type modifiers from all declaration files
stripTypeModifiersInDir(distDir);
