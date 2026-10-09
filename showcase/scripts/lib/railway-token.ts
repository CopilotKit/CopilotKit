import fs from "node:fs";
import path from "node:path";

/**
 * railway-token.ts — Shared resolver for the Railway GraphQL bearer.
 *
 * The Railway CLI stores the public-GraphQL bearer in `user.accessToken`.
 * The shorter `user.token` is a legacy CLI session token that does NOT
 * authenticate to the public GraphQL API. Older configs still on disk
 * have `user.token` set and `user.accessToken` empty; those callers get
 * a one-cycle deprecation warning and still work.
 *
 * Resolution order matches the first four candidates of
 * `showcase/bin/railway` `Auth.token`; the per-project
 * `projects.<id>.token` fallback is intentionally not honored (no
 * project-scoped tokens here):
 *   1. user.accessToken
 *   2. accessToken (top-level)
 *   3. user.token        (legacy → warn)
 *   4. token (top-level) (legacy → warn)
 *
 * Returns undefined when no usable token is present; callers print the
 * "set RAILWAY_TOKEN or run `railway login`" error.
 *
 * This resolver reads ONLY the parsed config object passed in and does
 * NOT consult `process.env.RAILWAY_TOKEN` — the caller is responsible
 * for the environment-variable lane. Any returned value is trimmed so
 * stray whitespace/newlines from `~/.railway/config.json` never reach
 * an `Authorization: Bearer <token>` header.
 */

export interface RailwayConfigShape {
  user?: {
    accessToken?: string;
    token?: string;
  };
  accessToken?: string;
  token?: string;
}

export interface ResolverDeps {
  warn?: (message: string) => void;
}

const DEPRECATION_MESSAGE =
  "[railway-token] WARNING: legacy Railway config field is deprecated: " +
  "`user.token` / top-level `token` no longer authenticates the public " +
  "GraphQL API. The Railway CLI now writes `user.accessToken`; re-run " +
  "`railway login` to refresh ~/.railway/config.json. Support for the " +
  "legacy field will be removed in a future release.";

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function resolveRailwayTokenFromConfig(
  config: RailwayConfigShape | null | undefined,
  deps: ResolverDeps = {},
): string | undefined {
  // Defensive guard: config originates from JSON.parse of
  // ~/.railway/config.json (untrusted). Reject anything that isn't a
  // plain object before property access.
  if (config === null || config === undefined) return undefined;
  if (typeof config !== "object") return undefined;
  if (Array.isArray(config)) return undefined;

  const warn = deps.warn ?? ((m: string) => console.warn(m));

  const userAccess = config.user?.accessToken;
  if (nonEmpty(userAccess)) return userAccess.trim();

  const topAccess = config.accessToken;
  if (nonEmpty(topAccess)) return topAccess.trim();

  const userLegacy = config.user?.token;
  if (nonEmpty(userLegacy)) {
    warn(DEPRECATION_MESSAGE);
    return userLegacy.trim();
  }

  const topLegacy = config.token;
  if (nonEmpty(topLegacy)) {
    warn(DEPRECATION_MESSAGE);
    return topLegacy.trim();
  }
  return undefined;
}

/**
 * Failure-mode codes for resolveRailwayToken. Each is a distinct,
 * actionable diagnostic so callers (and operators reading CI logs) can
 * tell exactly WHY token resolution failed:
 *
 *   NO_HOME            : $HOME is unset (so ~/.railway/config.json can't
 *                        be located) AND RAILWAY_TOKEN is also unset.
 *   NO_FILE            : $HOME is set but ~/.railway/config.json does
 *                        not exist (and env-var is unset).
 *   MALFORMED          : ~/.railway/config.json exists but JSON.parse
 *                        threw.
 *   NO_TOKEN_IN_CONFIG : ~/.railway/config.json exists and parses OK
 *                        but contains no usable token at any of the
 *                        four known layers. (Closes the silent-token-
 *                        fallthrough diagnostic gap where the operator
 *                        previously saw the generic "No Railway token
 *                        found" with no hint the file was inspected.)
 */
export type RailwayTokenErrorCode =
  | "NO_HOME"
  | "NO_FILE"
  | "MALFORMED"
  | "NO_TOKEN_IN_CONFIG";

export class RailwayTokenError extends Error {
  readonly code: RailwayTokenErrorCode;
  constructor(code: RailwayTokenErrorCode, message: string) {
    super(message);
    this.name = "RailwayTokenError";
    this.code = code;
  }
}

export interface ResolveRailwayTokenOptions extends ResolverDeps {
  /** Override $HOME lookup (testing only). */
  home?: string;
  /** Override env-var lookup (testing only). */
  env?: NodeJS.ProcessEnv;
  /** Filesystem injection (testing only). */
  fs?: Pick<typeof fs, "existsSync" | "readFileSync">;
}

export interface RailwayTokenResolution {
  token: string;
  source: "env" | "config";
}

/**
 * Unified entrypoint shared by redeploy-env.ts and
 * verify-railway-image-refs.ts. Encapsulates the previously-duplicated
 * getToken() envelope so the four failure modes can have distinct,
 * actionable diagnostics in one place.
 *
 * Resolution order:
 *   1. process.env.RAILWAY_TOKEN  (returned with source="env")
 *   2. ~/.railway/config.json via resolveRailwayTokenFromConfig
 *      (returned with source="config")
 *
 * Throws RailwayTokenError with a discriminator `.code` for each failure
 * mode (NO_HOME / NO_FILE / MALFORMED / NO_TOKEN_IN_CONFIG). NEVER calls
 * process.exit — the script entrypoint is responsible for mapping the
 * error to a non-zero exit code so this function stays unit-testable.
 */
export function resolveRailwayToken(
  opts: ResolveRailwayTokenOptions = {},
): RailwayTokenResolution {
  const env = opts.env ?? process.env;
  const fsImpl = opts.fs ?? fs;

  // Trim the env-var lane to honor the module's no-whitespace-in-header
  // invariant. A `RAILWAY_TOKEN` secret with a trailing newline (common
  // from `op read`/heredoc/shell export) would otherwise be returned
  // verbatim and produce an invalid `Authorization: Bearer <token>\n`
  // header → silent Railway 401. A whitespace-only value is treated as
  // UNSET (falls through to the config-file lane).
  const envToken = env.RAILWAY_TOKEN;
  if (typeof envToken === "string") {
    const trimmed = envToken.trim();
    if (trimmed.length > 0) {
      return { token: trimmed, source: "env" };
    }
  }

  const home = opts.home ?? env.HOME;
  if (!home) {
    throw new RailwayTokenError(
      "NO_HOME",
      "No Railway token found. RAILWAY_TOKEN is unset (or whitespace-only) and $HOME is unset so ~/.railway/config.json cannot be located.",
    );
  }

  const configPath = path.join(home, ".railway", "config.json");
  if (!fsImpl.existsSync(configPath)) {
    throw new RailwayTokenError(
      "NO_FILE",
      "No Railway token found. Set RAILWAY_TOKEN or run `railway login`.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(configPath, "utf-8"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new RailwayTokenError(
      "MALFORMED",
      `Malformed ~/.railway/config.json: ${msg}`,
    );
  }

  const token = resolveRailwayTokenFromConfig(
    parsed as RailwayConfigShape | null | undefined,
    opts,
  );
  if (typeof token === "string" && token.length > 0) {
    return { token, source: "config" };
  }

  throw new RailwayTokenError(
    "NO_TOKEN_IN_CONFIG",
    "No Railway token found: ~/.railway/config.json was found and parsed but contains no usable token (user.accessToken / accessToken / user.token / token). Set RAILWAY_TOKEN or re-run `railway login`.",
  );
}
