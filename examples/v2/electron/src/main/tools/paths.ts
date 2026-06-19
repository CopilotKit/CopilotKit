import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Canonicalize the existing portion of `target` by walking up to the nearest
 * ancestor that exists on disk, `realpathSync`-ing it (which resolves any
 * symlinks in that portion — including `target` itself if it exists), then
 * re-appending the non-existent tail segments.
 *
 * This lets us canonicalize symlinks for containment checks while still
 * supporting not-yet-existent targets (e.g. a file `fs_write` is about to
 * create), which `realpathSync(target)` alone would reject with ENOENT.
 */
function canonicalizeExisting(target: string): string {
  let existing = target;
  const tail: string[] = [];

  // Walk up until we find an existing ancestor. The filesystem root always
  // exists, so this terminates.
  for (;;) {
    try {
      const real = realpathSync(existing);
      // Re-append the non-existent tail (reversed back to forward order).
      return tail.length > 0 ? join(real, ...[...tail].toReversed()) : real;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) {
        // Reached the filesystem root without it resolving; fall back to the
        // lexical path so we never loop forever.
        return target;
      }
      tail.push(relative(parent, existing));
      existing = parent;
    }
  }
}

/**
 * Resolve a candidate path and verify it stays within the workspace root.
 *
 * Containment is checked against the *canonical* (symlink-resolved) paths, so
 * a symlink that lives inside the workspace but points outside it is rejected
 * — closing a sandbox-escape hole that a purely lexical check would miss.
 *
 * @param root      - The workspace root directory (may be relative to cwd).
 * @param candidate - The path to resolve; relative paths are resolved against `root`.
 * @returns The absolute, canonicalized path if it is inside the workspace root.
 * @throws {Error} When the resolved path escapes the workspace root.
 */
export function resolveInWorkspace(root: string, candidate: string): string {
  const lexicalRoot = resolve(root);

  // The lexical absolute target, resolved against the (lexical) root.
  const lexicalTarget = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(lexicalRoot, candidate);

  // Canonicalize the root. If the root does not yet exist on disk it can
  // contain no symlinks, so a purely lexical check is already sound — and
  // canonicalizing only one side (e.g. resolving a symlinked ancestor such as
  // macOS's /tmp -> /private/tmp on the target but not the equally
  // non-existent root) would create a spurious prefix mismatch. So in that
  // case we keep both sides lexical and compare them directly.
  let realRoot: string;
  try {
    realRoot = realpathSync(lexicalRoot);
  } catch {
    return assertContained(lexicalRoot, lexicalTarget, candidate);
  }

  // The root exists: canonicalize the existing portion of the target (which
  // resolves any symlink inside the workspace — including the file itself if
  // it exists — while tolerating a not-yet-created tail), then compare the
  // canonical paths so an in-workspace symlink pointing outside is rejected.
  const canonicalTarget = canonicalizeExisting(lexicalTarget);
  return assertContained(realRoot, canonicalTarget, candidate);
}

/**
 * Throw if `target` is not contained within `root`; otherwise return `target`.
 * Both paths must already be absolute and (where relevant) canonicalized.
 */
function assertContained(
  root: string,
  target: string,
  candidate: string,
): string {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(
      `Path "${candidate}" resolves outside the workspace root "${root}"`,
    );
  }
  return target;
}
