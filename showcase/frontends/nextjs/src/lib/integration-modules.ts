// Checks shared by the code that turns an integration slug or a demo id into
// a dynamic import path. It imports nothing, so build scripts can use it
// before the generated registry exists.

/** Integration slugs and demo ids: lowercase words joined by single hyphens. */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * True when `value` is a valid integration slug or demo id, for example
 * `"langgraph-python"` or `"agentic-chat"`.
 */
export function isKebabCase(value: string) {
  return KEBAB_CASE.test(value);
}

// Module-not-found codes: webpack and Node CommonJS use the first, Node ESM
// and Vite use the second.
const MODULE_NOT_FOUND_CODES = new Set([
  "MODULE_NOT_FOUND",
  "ERR_MODULE_NOT_FOUND",
]);

/**
 * True when `error` reports that `modulePath` itself does not exist. A module
 * that exists but imports something missing names that other module instead,
 * so its error is not swallowed.
 *
 * @param error - What a dynamic `import()` threw.
 * @param modulePath - The tail of the imported path, for example
 *   `"strands/demos/gen-ui-interrupt"`.
 */
export function isMissingModule(error: unknown, modulePath: string) {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const isNotFound =
    typeof error.code === "string" && MODULE_NOT_FOUND_CODES.has(error.code);
  return isNotFound && error.message.includes(modulePath);
}
