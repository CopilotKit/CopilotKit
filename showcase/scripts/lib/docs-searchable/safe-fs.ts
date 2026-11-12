// safe-fs — tiny path-traversal-safe filesystem helpers for use with
// user-influenced slug paths.
//
// The docs routes accept arbitrary slug segments (e.g. /docs/[[...slug]])
// and feed them into path.join(CONTENT_DIR, slugPath). A crafted URL
// like `/docs/..%2F..%2Fsecrets` decodes to `slugPath = "../../secrets"`,
// which path.join happily resolves OUTSIDE of CONTENT_DIR — giving an
// attacker read access to arbitrary files on disk.
//
// Every read in the docs-render pipeline routes through these helpers
// so a resolved path that escapes its declared base returns a safe
// miss (null / false) rather than leaking anything.

import fs from "fs";
import path from "path";

/**
 * Resolve `relative` under `baseDir` and return the resolved absolute
 * path iff it stays within `baseDir`. Returns null when the resolved
 * path would escape the base (path traversal) — callers should treat
 * this as "not found".
 */
export function resolveWithinDir(
  baseDir: string,
  relative: string,
): string | null {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relative);
  // Allow the base itself, or any descendant. path.sep so platform
  // separators are honored (Windows, though unlikely for this
  // codebase).
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return null;
  }
  return resolved;
}

/** existsSync variant that returns false on traversal attempts. */
export function safeExistsSync(baseDir: string, relative: string): boolean {
  const resolved = resolveWithinDir(baseDir, relative);
  if (!resolved) return false;
  return fs.existsSync(resolved);
}

/**
 * readFileSync variant that returns null on traversal attempts or when
 * the file does not exist. Same encoding semantics as fs.readFileSync.
 */
export function safeReadFileSync(
  baseDir: string,
  relative: string,
  encoding: BufferEncoding = "utf-8",
): string | null {
  const resolved = resolveWithinDir(baseDir, relative);
  if (!resolved) return null;
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved, encoding);
}
