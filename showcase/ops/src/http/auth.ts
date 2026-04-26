import crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * Thrown at construction time when no expected token is available.
 *
 * This is intentionally fail-loud: a misconfigured deployment that silently
 * defaulted to "always allow" is the failure mode this gate exists to
 * prevent. Operators must see the error during boot, not after the trigger
 * endpoint starts accepting unauthenticated requests in production.
 */
export class MissingAuthTokenError extends Error {
  constructor(envVar: string) {
    super(
      `bearerAuth: no expected token configured. Set ${envVar} or pass an explicit expectedToken option.`,
    );
    this.name = "MissingAuthTokenError";
  }
}

/**
 * Constant-time string comparison.
 *
 * Wraps `crypto.timingSafeEqual` with two operator-friendly behaviors that
 * the raw primitive lacks:
 *
 *   1. Length-mismatch returns `false` instead of throwing. The naked
 *      `timingSafeEqual` requires equal-length buffers; throwing on
 *      mismatch leaks length via timing AND surfaces as a 500 to the
 *      caller. We swallow the mismatch and report a plain auth failure.
 *   2. Empty strings always return `false`. An empty token is never a
 *      valid credential — we refuse to even attempt the compare so a
 *      construction bug that produces "" can't masquerade as a valid
 *      match.
 *
 * Exported for direct unit-test coverage; the regex on
 * `crypto.timingSafeEqual` is non-trivial to assert on indirectly.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface BearerAuthOptions {
  /**
   * Explicit expected token. When provided, takes priority over the env
   * lookup. Useful for tests and for callers that load the token from a
   * non-env source (e.g. a secrets manager).
   */
  expectedToken?: string;
  /**
   * Name of the env var to read at construction time when `expectedToken`
   * is not provided. Defaults to `OPS_TRIGGER_TOKEN`.
   */
  envVar?: string;
}

const DEFAULT_ENV_VAR = "OPS_TRIGGER_TOKEN";

/**
 * Construct a Hono bearer-auth middleware.
 *
 * Rejects with 401 + `{error: "unauthorized"}` JSON when:
 *   - the Authorization header is absent
 *   - the header is present but does not start with `Bearer ` (case-insensitive scheme per RFC 6750 §2.1)
 *   - the bearer token does not match the expected token (constant-time compare)
 *
 * Calls `next()` on a successful match.
 *
 * Construction is fail-loud: if no `expectedToken` is supplied AND the
 * env var is unset/empty, this function throws `MissingAuthTokenError`
 * during boot. Defaulting to "always reject" or "always allow" would both
 * be footguns — a misconfigured deployment must surface during init, not
 * silently degrade once a trigger endpoint is hit.
 */
export function bearerAuth(opts: BearerAuthOptions = {}): MiddlewareHandler {
  const envVar = opts.envVar ?? DEFAULT_ENV_VAR;
  const expectedToken =
    opts.expectedToken !== undefined ? opts.expectedToken : process.env[envVar];

  if (!expectedToken) {
    // Fail-loud: empty string and undefined both treated as misconfig.
    throw new MissingAuthTokenError(envVar);
  }

  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    // RFC 6750 §2.1: the auth-scheme is case-insensitive. Be lenient on
    // "Bearer "/"bearer " etc., strict on the token portion.
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const presented = match[1].trim();
    if (!constantTimeEqual(presented, expectedToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
