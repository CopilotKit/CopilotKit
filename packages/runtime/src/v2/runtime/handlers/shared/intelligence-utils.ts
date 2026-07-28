import { PlatformRequestError } from "../../intelligence-platform/client";

/**
 * Returns the HTTP status carried by platform request errors.
 */
export function getPlatformErrorStatus(error: unknown): number | undefined {
  if (error instanceof PlatformRequestError) {
    return error.status;
  }

  if (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return undefined;
}

export function isPlatformNotFoundError(error: unknown): boolean {
  return getPlatformErrorStatus(error) === 404;
}

const MAX_ID_LENGTH = 128;
const SAFE_ID_PATTERN = /^[\w.@:=-]+$/;

/**
 * Validates that an AGENT or ROUTE identifier is safe to pass through.
 * Returns `true` if valid, `false` otherwise.
 *
 * Deliberately strict: these values are chosen by the developer and land in URL
 * path segments, so a safe slug is both achievable and desirable. App-user ids
 * are NOT validated here — see {@link isValidAppUserId}.
 */
export function isValidIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    SAFE_ID_PATTERN.test(value)
  );
}

const MAX_APP_USER_ID_LENGTH = 512;
// Whitespace, C0 control characters, and DEL. Deliberately a DENY list on
// structure rather than an allow list on charset: `-`, `_`, `.`, `:`, `@` and
// base64url bytes all occur in real provider identities. CR/LF are the values
// that actually matter here — the id is stamped into an outbound header.
const UNSAFE_APP_USER_ID_PATTERN = /[\s\x00-\x1f\x7f]/;

/**
 * Validates a bare app-user id — the identity Intelligence stores on
 * `threads.end_user_id` and forwards as the MCP memory header.
 *
 * Deliberately laxer than {@link isValidIdentifier}, which bounds agent and
 * route identifiers at 128 safe-slug characters. An app-user id is neither: a
 * managed Channel identity embeds a provider-opaque actor id (a Teams MRI can
 * exceed 128 chars and is not a slug), and it is a PUBLIC id that must never be
 * hashed or rewritten to satisfy a generic validator (OSS-643). Conflating the
 * two forced a choice between dropping real users and mangling their ids; this
 * split removes it.
 */
export function isValidAppUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_APP_USER_ID_LENGTH &&
    !UNSAFE_APP_USER_ID_PATTERN.test(value)
  );
}
