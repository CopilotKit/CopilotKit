/**
 * Walk-up `package.json` resolver — used by CLI scripts (notably
 * `scripts/d6-capture-references.ts`) that need to derive paths
 * relative to the package root regardless of whether the script is
 * running from source (`<package>/scripts/foo.ts`) or after build
 * (`<package>/dist/scripts/foo.js`).
 *
 * `path.dirname(import.meta.url) + ".."` collapses to different
 * destinations depending on src vs dist; walking up to the first
 * `package.json` is source/dist-symmetric and matches how every npm /
 * Nx tool resolves "package root".
 *
 * Pure (apart from the filesystem stat) and dependency-injected so
 * unit tests can substitute a deterministic `exists` predicate without
 * touching disk.
 */

import { existsSync } from "node:fs";
import path from "node:path";

/** Hard cap on hops walking upward, purely a runaway-loop safety. */
const MAX_HOPS = 16;

/**
 * Walk up from `startDir` until a directory containing `package.json`
 * is found, and return that directory. Throws when no `package.json`
 * is encountered before reaching the filesystem root — that signals
 * the script is running outside any package, which is a misconfig.
 *
 * @param startDir   directory to start the walk from (inclusive).
 * @param exists     predicate for "does this path exist?"; injectable
 *                   for tests. Default = `fs.existsSync`.
 */
export function findPackageRoot(
  startDir: string,
  exists: (p: string) => boolean = existsSync,
): string {
  let dir = startDir;
  for (let i = 0; i < MAX_HOPS; i++) {
    if (exists(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `findPackageRoot: no package.json found walking up from ${startDir}`,
  );
}
