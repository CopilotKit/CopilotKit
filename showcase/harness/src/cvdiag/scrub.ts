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
/**
 * `sk-…` secret keys, including modern base64url-bodied formats:
 *   - legacy OpenAI:   `sk-<16+ alnum>`
 *   - OpenAI project:  `sk-proj-<…>`
 *   - Anthropic:       `sk-ant-api03-AbCd_Ef-0123456789xyzAB` (base64url body:
 *     the alphabet INCLUDES `_` and `-`, and the entropy tail can sit AFTER a
 *     hyphen segment, so the legacy "≥16 alnum run after the last hyphen" gate
 *     leaked it).
 * Pattern: `sk-` then a base64url body (`[A-Za-z0-9_-]`) that CONTAINS at least
 * one ≥12-char CONTIGUOUS alphanumeric entropy run, optionally trailed by more
 * base64url chars. The ≥12-char alnum run is the entropy gate: real keys carry
 * a long random alnum block (the shortest tail in the modern corpus,
 * `0123456789xyzAB`, is 15 chars), whereas ordinary hyphenated/underscored
 * prose after an `sk-` (`ask-me-later` → `me`/`later`, `task_list_items` uses
 * `sk_` not `sk-`) has no such run, so prose is left untouched.
 */
export const SK_KEY_REGEX =
  /sk-(?:[A-Za-z0-9_-]*[A-Za-z0-9]{12,})[A-Za-z0-9_-]*/g;
/**
 * URL userinfo authority segment. Redacts the FULL userinfo authority between
 * `scheme://` and the LAST `@` before the host/path, covering:
 *   - `scheme://user:password@host`,
 *   - bare-token `scheme://token@host` (no colon; e.g. `https://ghp_xxx@host`),
 *   - multi-`@` authorities `scheme://a@b@c.com` (the legacy `[^/@\s]+@` stopped
 *     at the FIRST `@`, leaking the `b@c.com` tail).
 * The userinfo span is any run of non-`/`, non-whitespace characters up to the
 * LAST `@` (greedy `[^/\s]*@`); excluding `/` keeps the match from crossing
 * into the path, so a path with no userinfo is never matched.
 */
export const URL_USERINFO_REGEX = /([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi;

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

/** True for a plain `{}`-style object (walk its values); not Date/RegExp/etc. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Deep secret-scrub of an arbitrary metadata value (spec §6). Applies
 * `scrubSecrets` to EVERY string leaf at any depth — inside arrays and plain
 * objects — while preserving structure and non-string leaves
 * (numbers/booleans/null) verbatim. Used by `validateMetadata` so a secret
 * buried in a nested allow-listed value (e.g. `backend.error.caught.stack_brief`,
 * `aimock.match.decision.reject_reasons`) cannot bypass the top-level scrub.
 *
 * SAFETY: metadata can be untrusted, so the walk is ITERATIVE (an explicit
 * work stack, never the call stack) and guards visited containers with a
 * WeakSet — a self-referential / cyclic object is visited once and never
 * re-entered, so neither a deep nor a cyclic structure can stack-overflow or
 * hang. Only plain objects and arrays are descended into; other object kinds
 * (Date, RegExp, etc.) are left as-is (they have no string leaves to scrub and
 * walking their internals is unsafe). Containers are scrubbed in place; pass a
 * fresh clone if the input must not be mutated.
 */
export function scrubDeep(value: unknown): unknown {
  if (typeof value === "string") return scrubSecrets(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return value;

  const seen = new WeakSet<object>();
  // Work items are containers (array | plain object) whose string children we
  // scrub in place and whose container children we push for later processing.
  const stack: Array<unknown[] | Record<string, unknown>> = [
    value as unknown[] | Record<string, unknown>,
  ];
  seen.add(value as object);

  while (stack.length > 0) {
    const container = stack.pop()!;
    if (Array.isArray(container)) {
      for (let i = 0; i < container.length; i += 1) {
        const child = container[i];
        if (typeof child === "string") {
          container[i] = scrubSecrets(child);
        } else if (
          (Array.isArray(child) || isPlainObject(child)) &&
          !seen.has(child as object)
        ) {
          seen.add(child as object);
          stack.push(child as unknown[] | Record<string, unknown>);
        }
      }
    } else {
      for (const key of Object.keys(container)) {
        const child = container[key];
        if (typeof child === "string") {
          container[key] = scrubSecrets(child);
        } else if (
          (Array.isArray(child) || isPlainObject(child)) &&
          !seen.has(child as object)
        ) {
          seen.add(child as object);
          stack.push(child as unknown[] | Record<string, unknown>);
        }
      }
    }
  }
  return value;
}
