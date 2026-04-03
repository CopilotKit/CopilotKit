/**
 * Post-build script: copies .d.cts → .d.ts and .d.cts.map → .d.ts.map
 * so that consumers on legacy moduleResolution ("node") can resolve types.
 *
 * Usage: node scripts/copy-dts.mjs [dir]
 *   dir defaults to ./dist
 */

import { readdirSync, copyFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve(process.argv[2] || "dist");

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (entry.endsWith(".d.cts")) {
      const target = full.replace(/\.d\.cts$/, ".d.ts");
      copyFileSync(full, target);
    } else if (entry.endsWith(".d.cts.map")) {
      const target = full.replace(/\.d\.cts\.map$/, ".d.ts.map");
      copyFileSync(full, target);
    }
  }
}

walk(distDir);
