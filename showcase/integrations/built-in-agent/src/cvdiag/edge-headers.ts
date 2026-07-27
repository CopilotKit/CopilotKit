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

import type { EdgeHeaders, EdgeHeaderKey } from "./schema";
import { EDGE_HEADER_KEYS } from "./schema";

// Secret/PII scrub primitives live in the leaf `scrub.ts` module so that
// `schema.ts` can scrub metadata values without forming a `schema → edge-headers
// → schema` import cycle. Re-exported here to preserve the historical public
// surface (`scrubSecrets`, the regex constants, `SCRUB_REPLACEMENT`) — callers
// that import these from `edge-headers.js` (and the `index.ts` `export *`)
// continue to resolve unchanged.
export {
  BEARER_TOKEN_REGEX,
  SK_KEY_REGEX,
  URL_USERINFO_REGEX,
  SCRUB_REPLACEMENT,
  scrubSecrets,
  scrubDeep,
} from "./scrub";

/** The 9 allow-listed edge-header keys (spec §5). */
export const EDGE_HEADER_ALLOWLIST: readonly string[] = EDGE_HEADER_KEYS;

/**
 * Maximum captured length (chars) for any single edge-header value (spec §3.1
 * `edge_headers` row, §1.6 — edge-header values are semi-untrusted/unbounded
 * upstream input). A value exceeding this is truncated to this length with a
 * trailing `…` marker at capture time; `null` values are untouched.
 */
export const EDGE_HEADER_MAX_LEN = 256;

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
  // key is read from the normalized map (deny-list keys never made it in) and
  // bounded to EDGE_HEADER_MAX_LEN — a non-null value longer than the cap is
  // truncated with a trailing `…` marker; `null` stays `null`.
  const get = (key: EdgeHeaderKey): string | null => {
    const value = normalized.has(key) ? (normalized.get(key) ?? null) : null;
    if (value === null || value.length <= EDGE_HEADER_MAX_LEN) {
      return value;
    }
    // Reserve one char for the `…` marker so the result is ≤ EDGE_HEADER_MAX_LEN.
    return value.slice(0, EDGE_HEADER_MAX_LEN - 1) + "…";
  };
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
