/**
 * scrub.ts — PII / secret scrub primitives for CVDIAG (spec §6).
 *
 * Leaf module with NO intra-cvdiag imports. Both `schema.ts` (metadata-value
 * scrub in `validateMetadata`) and `edge-headers.ts` (which re-exports these
 * symbols for back-compat) depend on it. Keeping the scrub here avoids a
 * `schema.ts → edge-headers.ts → schema.ts` import cycle: `edge-headers.ts`
 * imports `EDGE_HEADER_KEYS` from `schema.ts`, so `schema.ts` cannot import
 * `scrubSecrets` from `edge-headers.ts` without forming a cycle.
 */

// ── PII / secret scrub regex constants (spec §6) ────────────────────────────

/** `Bearer <token>` anywhere in a captured value. */
export const BEARER_TOKEN_REGEX = /Bearer\s+\S+/g;
/** OpenAI-style secret keys `sk-…` (≥16 trailing chars). */
export const SK_KEY_REGEX = /sk-[A-Za-z0-9]{16,}/g;
/**
 * URL userinfo segment. Matches both the `scheme://user:password@` form AND a
 * bare-token `scheme://token@` form (no colon) so single-token credentials
 * (e.g. `https://ghp_xxx@host`) are redacted too. The userinfo span is any run
 * of non-`/`, non-`@`, non-whitespace characters (optionally containing a
 * `:password` segment) immediately followed by `@`.
 */
export const URL_USERINFO_REGEX = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi;

/** Replacement token written in place of a scrubbed secret. */
export const SCRUB_REPLACEMENT = "[REDACTED]";

/**
 * Scrub known secret patterns from an arbitrary captured string value (spec
 * §6). Applied to metadata values that may carry user/provider strings (e.g.
 * `backend.error.caught.message_scrubbed`). Returns the scrubbed string.
 */
export function scrubSecrets(value: string): string {
  return value
    .replace(BEARER_TOKEN_REGEX, SCRUB_REPLACEMENT)
    .replace(SK_KEY_REGEX, SCRUB_REPLACEMENT)
    .replace(URL_USERINFO_REGEX, `$1${SCRUB_REPLACEMENT}@`);
}
