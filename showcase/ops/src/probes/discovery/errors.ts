/**
 * Structured error classes for discovery sources. Mirrors the pattern used
 * in the probe-invoker: a discovery source throws; the invoker catches and
 * converts into a logged failure. Keeping the error classes as named types
 * (vs bare `Error`) lets operators distinguish "source couldn't reach
 * Railway" from "the YAML/manifest tree is malformed" in log output without
 * string-matching on `.message`.
 *
 * Callers in tests also match on class identity (`err instanceof
 * DiscoverySourceSchemaError`) rather than string contents so renames or
 * message tweaks don't silently break the assertion.
 */

/**
 * Thrown when a discovery source encounters a malformed input file — a
 * YAML that doesn't parse, a package.json missing `name`/`version`, etc.
 * The `filePath` field is load-bearing: without it, an operator staring at
 * a "malformed" error has no way to know which of 50 package.json files
 * to look at. The invoker logs this field explicitly.
 */
export class DiscoverySourceSchemaError extends Error {
  readonly filePath: string;
  constructor(message: string, filePath: string) {
    super(`${message} (file: ${filePath})`);
    this.name = "DiscoverySourceSchemaError";
    this.filePath = filePath;
  }
}

/**
 * Thrown when a discovery source cannot reach its input at all — the
 * workspace file is missing, the configured root directory doesn't
 * exist, etc. Kept distinct from SchemaError so operators can tell "file
 * is corrupt" from "file isn't there". The invoker treats both as a
 * failed enumeration (empty input list + logged error), but the log
 * message differs.
 */
export class DiscoverySourceNotFoundError extends Error {
  readonly filePath: string;
  constructor(message: string, filePath: string) {
    super(`${message} (file: ${filePath})`);
    this.name = "DiscoverySourceNotFoundError";
    this.filePath = filePath;
  }
}
