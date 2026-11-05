import { isModuleNotFound } from "../runtime/core/channel-manager";

/**
 * Load an optional peer dependency on first use.
 *
 * When the package is not installed, this throws an `Error` that names the
 * package and the command to install it. The original resolution error is
 * kept as `cause`. Any other error (for example, the package throws while it
 * loads) is rethrown unchanged, so a real failure inside the package does not
 * look like an install problem.
 *
 * The specifier is a runtime string, not a literal `import("...")`: a literal
 * becomes a static `require` in the CJS build and a hard "module not found"
 * build error in app bundlers when the peer is not installed.
 *
 * @param packageName - The npm package to load, for example `"@tanstack/ai-anthropic"`.
 *   It is also the name in the install hint, so pass a package name, not a subpath.
 * @param usage - What the package is needed for. It completes the sentence
 *   "Install <packageName> to use <usage>", for example `'"anthropic/claude-sonnet-4-6" models'`.
 * @returns The module namespace, typed as `TModule`.
 * @throws Error with the install hint and `cause` when the package cannot be resolved.
 *
 * @example
 * ```ts
 * const anthropic = await loadOptionalPeer<typeof import("@tanstack/ai-anthropic")>(
 *   "@tanstack/ai-anthropic",
 *   '"anthropic/claude-sonnet-4-6" models',
 * );
 * ```
 */
export async function loadOptionalPeer<TModule = unknown>(
  packageName: string,
  usage: string,
) {
  try {
    // The magic comments keep webpack and Vite from trying to resolve the
    // non-literal specifier at build time; Node resolves it when it runs.
    const mod: unknown = await import(
      /* webpackIgnore: true */ /* @vite-ignore */ packageName
    );
    // The module type cannot be inferred from a runtime string.
    return mod as TModule;
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new Error(
        `Install ${packageName} to use ${usage}: npm install ${packageName}`,
        { cause: err },
      );
    }
    throw err;
  }
}
