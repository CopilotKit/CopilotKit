import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Walk-up project-root detection for `cpk-studio` invocations without
 * `--root`.
 *
 * Heuristic: starting from `startDir`, walk upward looking for the nearest
 * `package.json` whose `dependencies` or `devDependencies` mention a
 * `@copilotkit/*` package. Same approach `nx` and most dev tools use.
 *
 * Why not just "nearest `package.json`": users run the studio from
 * `examples/...` subdirectories where the nearest `package.json` belongs to a
 * single example. Walking until we hit *any* package.json would point the
 * scanner at that example only, missing siblings. Requiring a CopilotKit dep
 * gives us a better anchor: in a monorepo it lands on the workspace root; in
 * a standalone app it lands on the app's package.json (which *does* depend on
 * `@copilotkit/react-core` etc.).
 *
 * Hard stop at the filesystem root or after `MAX_DEPTH` levels — defensive
 * against pathological symlink loops the OS would normally catch.
 */

const MAX_DEPTH = 30;

export type ProjectRootResult = {
  rootDir: string;
  /** The package.json that matched. Surfaced for diagnostic logging. */
  packageJsonPath: string;
};

export class ProjectRootNotFoundError extends Error {
  constructor(startDir: string) {
    super(
      `Could not find a CopilotKit project root walking up from ${startDir}. ` +
        `No package.json with a "@copilotkit/*" dependency was found. ` +
        `Pass --root <path> explicitly, or run cpk-studio from inside a ` +
        `CopilotKit-using project.`,
    );
    this.name = "ProjectRootNotFoundError";
  }
}

/**
 * Walk up from `startDir`, returning the first matching project root.
 *
 * `startDir` defaults to `process.cwd()`; pass an absolute path otherwise.
 * The returned `rootDir` is absolute.
 *
 * Throws `ProjectRootNotFoundError` when no match is found before hitting
 * either the filesystem root or `MAX_DEPTH`. Callers should print a clear
 * message and exit non-zero.
 */
export async function findProjectRoot(
  startDir: string = process.cwd(),
): Promise<ProjectRootResult> {
  let current = resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const candidate = `${current}/package.json`;
    const match = await readMatchingPackageJson(candidate);
    if (match) {
      return { rootDir: current, packageJsonPath: candidate };
    }
    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding a match.
      break;
    }
    current = parent;
  }
  throw new ProjectRootNotFoundError(startDir);
}

/**
 * Returns the parsed package.json when it exists *and* has a
 * `@copilotkit/*` dep in either `dependencies` or `devDependencies`. Returns
 * `null` otherwise (missing file, parse error, no match — all collapsed to
 * "not a hit", so the walk-up continues).
 */
async function readMatchingPackageJson(
  path: string,
): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (hasCopilotKitDep(parsed)) return parsed;
  return null;
}

function hasCopilotKitDep(pkg: Record<string, unknown>): boolean {
  for (const field of ["dependencies", "devDependencies"] as const) {
    const block = pkg[field];
    if (!block || typeof block !== "object") continue;
    for (const dep of Object.keys(block as Record<string, unknown>)) {
      if (dep === "@copilotkit" || dep.startsWith("@copilotkit/")) return true;
    }
  }
  return false;
}
