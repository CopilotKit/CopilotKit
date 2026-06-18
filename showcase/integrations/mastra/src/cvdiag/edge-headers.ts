/**
 * edge-headers.ts — edge-header allow-list / deny-list filter + PII scrub
 * constants for CVDIAG (spec §5 `edge_headers` shape + forbidden DENY list,
 * §6 PII handling). Plan unit: L0-A.
 *
 * Contract:
 *   - ONLY the 9 allow-listed keys (`EDGE_HEADER_ALLOWLIST`) are ever
 *     captured. Every result carries all 9 keys; an absent header is `null`.
 *   - The 12-name DENY list (`EDGE_HEADER_DENYLIST`) is rejected by EXACT
 *     match even if a key somehow appears in the allow-list — deny wins. There
 *     is NO `cf-ip*` prefix wildcard; the `cf-ip*` family is blocked by exact
 *     deny-list entries only.
 *   - Header-name comparison is case-insensitive (HTTP header names are
 *     case-insensitive); both lists are stored lowercase.
 */

import type { EdgeHeaders, EdgeHeaderKey } from "./schema.js";
import { EDGE_HEADER_KEYS } from "./schema.js";

/** The 9 allow-listed edge-header keys (spec §5). */
export const EDGE_HEADER_ALLOWLIST: readonly string[] = EDGE_HEADER_KEYS;

/**
 * The 12 forbidden edge-header names (spec §5 "Forbidden edge headers" DENY
 * list, R6-F2). Exact-match, NOT prefix-wildcard — the `cf-ip*` family is
 * blocked by these explicit entries, never by a regex prefix. A deny-list key
 * is rejected even if it accidentally appears in the allow-list.
 */
export const EDGE_HEADER_DENYLIST: readonly string[] = [
  "cf-ipcountry",
  "cf-connecting-ip",
  "cf-ipcity",
  "cf-iplatitude",
  "cf-iplongitude",
  "cf-iptimezone",
  "cf-visitor",
  "cf-worker",
  "true-client-ip",
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
];

const ALLOWLIST_SET: ReadonlySet<string> = new Set(EDGE_HEADER_ALLOWLIST);
const DENYLIST_SET: ReadonlySet<string> = new Set(EDGE_HEADER_DENYLIST);

// ── PII / secret scrub regex constants (spec §6) ────────────────────────────

/** `Bearer <token>` anywhere in a captured value. */
export const BEARER_TOKEN_REGEX = /Bearer\s+\S+/g;
/** OpenAI-style secret keys `sk-…` (≥16 trailing chars). */
export const SK_KEY_REGEX = /sk-[A-Za-z0-9]{16,}/g;
/** URL userinfo segment `scheme://user:password@`. */
export const URL_USERINFO_REGEX =
  /([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi;

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

/**
 * Filter a raw header bag down to the closed `EdgeHeaders` shape.
 *
 *   1. Every one of the 9 allow-listed keys is present on the result; an
 *      absent (or null/undefined) header becomes `null`, a present-but-empty
 *      header becomes `""`.
 *   2. A deny-list key is REJECTED even if it appears in the allow-list — the
 *      deny check runs first and wins (defense in depth; the lists are
 *      disjoint by construction, but this guard is asserted by a regression
 *      test).
 *   3. Any key not on the allow-list is silently dropped (closed-world).
 *
 * Header-name lookup is case-insensitive.
 */
export function filterEdgeHeaders(
  raw: Record<string, string | null | undefined>,
): EdgeHeaders {
  // Normalize incoming keys to lowercase for case-insensitive lookup, while
  // honoring the deny-list (deny wins over allow).
  const normalized = new Map<string, string | null>();
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = rawKey.toLowerCase();
    if (DENYLIST_SET.has(key)) {
      // Reject outright — never capture a deny-list header, even if it also
      // appears in the allow-list.
      continue;
    }
    if (!ALLOWLIST_SET.has(key)) {
      continue;
    }
    normalized.set(key, rawValue ?? null);
  }

  // Build a result with ALL 9 allow-list keys present (absent → null). Each
  // key is read from the normalized map (deny-list keys never made it in).
  const get = (key: EdgeHeaderKey): string | null =>
    normalized.has(key) ? (normalized.get(key) ?? null) : null;
  return {
    "cf-ray": get("cf-ray"),
    "cf-mitigated": get("cf-mitigated"),
    "cf-cache-status": get("cf-cache-status"),
    "x-railway-edge": get("x-railway-edge"),
    "x-railway-request-id": get("x-railway-request-id"),
    "x-hikari-trace": get("x-hikari-trace"),
    "retry-after": get("retry-after"),
    via: get("via"),
    server: get("server"),
  };
}
