import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Resolve a candidate path and verify it stays within the workspace root.
 *
 * @param root      - The workspace root directory (may be relative to cwd).
 * @param candidate - The path to resolve; relative paths are resolved against `root`.
 * @returns The absolute, canonicalized path if it is inside the workspace root.
 * @throws {Error} When the resolved path escapes the workspace root.
 */
export function resolveInWorkspace(root: string, candidate: string): string {
  const absRoot = resolve(root);
  const absTarget = isAbsolute(candidate)
    ? candidate
    : resolve(absRoot, candidate);

  const rel = relative(absRoot, absTarget);

  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(
      `Path "${candidate}" resolves outside the workspace root "${absRoot}"`,
    );
  }

  return absTarget;
}
