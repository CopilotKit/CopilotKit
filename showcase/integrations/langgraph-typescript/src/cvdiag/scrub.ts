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

/** `Bearer <token>` anywhere in a captured value. Linear: `\s+\S+` cannot
 * overlap (whitespace vs non-whitespace are disjoint classes), so there is no
 * super-linear backtracking. */
export const BEARER_TOKEN_REGEX = /Bearer\s+\S+/g;
/**
 * `sk-…` secret keys, including modern base64url-bodied formats:
 *   - legacy OpenAI:   `sk-<…16+ alnum…>`
 *   - OpenAI project:  `sk-proj-<…>`
 *   - Anthropic:       `sk-ant-api03-AbCd_Ef-0123456789xyzAB` (base64url body:
 *     the alphabet INCLUDES `_` and `-`, and the entropy tail can sit AFTER a
 *     hyphen segment, so the legacy "≥16 alnum run after the last hyphen" gate
 *     leaked it).
 *
 * REDESIGN (spec §3.2.3, R5-A1): the legacy form
 * `sk-(?:[A-Za-z0-9_-]star[A-Za-z0-9]{12,})[A-Za-z0-9_-]star` (where `star` is
 * a `*` quantifier; spelled out so the comment does not embed a `<star><slash>`
 * comment terminator) had two adjacent
 * UNBOUNDED quantifiers (`[A-Za-z0-9_-]*` … `{12,}`) whose character classes
 * OVERLAP — the classic catastrophic-backtracking shape: on a long all-`a`
 * string the engine tries every partition of the run between the `*` and the
 * `{12,}`, which is O(n²)+ and produced the ~1.4s R5-A1 stall on
 * `sk-` + 4000×`a`.
 *
 * The new form makes EVERY window BOUNDED with no overlapping-unbounded pair:
 *   `sk-` then up to 200 base64url chars, a 12-char CONTIGUOUS alphanumeric
 *   ENTROPY run (the gate that keeps prose like `ask-me-later` from matching),
 *   then up to 200 more base64url chars.
 * Each quantifier is bounded (`{0,200}`, `{12}`), so worst-case work is a fixed
 * constant per start position → linear in input length, no backtracking blowup.
 * The 200-wide windows scan a body up to 3+200+12+200 = 415 chars, exceeding
 * the longest known provider key so the WHOLE key is redacted (a smaller window
 * would leave an un-redacted head/tail = partial-secret leak).
 */
export const SK_KEY_REGEX =
  /sk-[A-Za-z0-9_-]{0,200}[A-Za-z0-9]{12}[A-Za-z0-9_-]{0,200}/g;
/**
 * URL userinfo authority segment. Redacts the userinfo between `scheme://` and
 * the LAST `@` WITHIN the authority, covering:
 *   - `scheme://user:password@host`,
 *   - bare-token `scheme://token@host` (no colon; e.g. `https://ghp_xxx@host`),
 *   - multi-`@` authorities `scheme://a@b@c.com` (greedy to the last authority
 *     `@`; the legacy `[^/@\s]+@` stopped at the FIRST `@`, leaking `b@c.com`).
 *
 * REDESIGN (spec §3.2.3, R5-A2): the userinfo class is `[^/\s?#]*` — it now
 * EXCLUDES `?` and `#` in addition to `/` and whitespace, so the match can
 * never cross into the path, query, or fragment. This fixes R5-A2 where the
 * old `[^/\s]*@` crossed the `?` of `https://host.com?email=a@b.com` and
 * destroyed the host. Linear (a single bounded-class run, no overlapping
 * quantifiers). Replacement keeps the scheme: `$1[REDACTED]@`.
 */
export const URL_USERINFO_REGEX = /([a-z][a-z0-9+.-]*:\/\/)[^/\s?#]*@/gi;

/** Replacement token written in place of a scrubbed secret. */
export const SCRUB_REPLACEMENT = "[REDACTED]";

/**
 * Hard input-size guard (spec §3.2.4 P2; open-question 1 flags this as tunable):
 * no regex ever runs on a string longer than this. 2 KB covers any legitimate
 * metadata value (schema `message_scrubbed` ≤512 B, other free-text metadata
 * values are small) with ample headroom, while keeping the absolute worst-case
 * scan cost small (the `{0,200}` windows make the at-ceiling scan ~4× cheaper
 * than at 8 KB) so the scrub can never perceptibly affect the diagnostic
 * boundary. The bounded-prefix `…[unscanned:N]` path handles anything larger.
 */
export const SCRUB_MAX_SCAN_LEN = 2 * 1024;

/**
 * Max containers the deep walker visits (spec §3.2.5 P3) before it stops
 * descending and copies the remaining subtree by reference unscrubbed — bounds
 * a nesting bomb cheaply without a recursive parser. Counts CONTAINERS (each
 * popped work item), not leaves.
 */
export const SCRUB_MAX_NODES = 10_000;

/**
 * Scrub known secret patterns from an arbitrary captured string value (spec
 * §6). Applied to metadata values that may carry user/provider strings (e.g.
 * `backend.error.caught.message_scrubbed`). Returns the scrubbed string.
 *
 * P2 (spec §3.2.4): a value longer than `maxScanLen` NEVER reaches a regex —
 * only the bounded prefix is scanned, and a self-describing `…[unscanned:<N>]`
 * marker records the dropped tail length (`N` is a char count). With a bounded
 * input and the three LINEAR regexes above, ReDoS is impossible by construction
 * (bounded length × linear regex = O(constant) worst case). The marker is
 * appended AFTER scrubbing so it can never be mistaken for scrubbed content;
 * callers that re-clamp by byte size (the §7 byte-cap) handle the
 * slightly-longer string transparently.
 *
 * `maxScanLen` defaults to `SCRUB_MAX_SCAN_LEN` (2 KB) — the correct bound for
 * the DEFAULT-tier metadata hot path (legit values ≤512 B). The DEBUG-tier
 * raw-byte pipeline (`raw-byte-capture.ts`) legitimately scrubs a much larger
 * decoded wire body and passes its OWN head+tail-derived bound, so the 2 KB
 * metadata guard does not destructively truncate the body before its head+tail
 * cap runs. The linearity of the three regexes makes the larger raw-byte bound
 * just as ReDoS-safe — the metadata default is a hot-path latency budget, not a
 * correctness requirement.
 */
export function scrubSecrets(
  value: string,
  maxScanLen: number = SCRUB_MAX_SCAN_LEN,
): string {
  if (value.length > maxScanLen) {
    const droppedTail = value.length - maxScanLen;
    const scanned = value.slice(0, maxScanLen);
    return `${runScrubRegexes(scanned)}…[unscanned:${droppedTail}]`;
  }
  return runScrubRegexes(value);
}

/**
 * The three linear-time secret regexes, applied in sequence. Each is a global
 * (`/g`) regex; `String.prototype.replace` resets `lastIndex` after a global
 * replace, so re-use across calls is safe.
 */
function runScrubRegexes(value: string): string {
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

type Container = unknown[] | Record<string, unknown>;

/**
 * Deep secret-scrub that BUILDS A FRESH COPY of an arbitrary metadata value
 * (spec §6 / §3.2.5 P3) — it NEVER mutates the caller's object. This removes
 * the R5-A4 `structuredClone`-then-mutate trap entirely: there is no clone that
 * can throw on an unclonable leaf and force a mutating fallback.
 *
 * - Iterative walker (explicit work stack, never the call stack) so neither a
 *   deeply-nested nor a cyclic structure can stack-overflow.
 * - String leaves → `scrubSecrets(child)` written into the NEW container.
 * - Non-string, non-plain-object/array leaves (numbers/booleans/null AND
 *   unclonable leaves like functions / class instances / Date / RegExp) are
 *   copied BY REFERENCE into the new container, unscrubbed (no string to scrub,
 *   and we must never mutate the caller's leaf).
 * - Cycle guard + dedupe: a `WeakMap<originalContainer, newContainer>` is BOTH
 *   the "seen" set and the dedupe map — a container reached twice maps to the
 *   SAME new container, preserving shared/cyclic structure without an infinite
 *   loop.
 * - Node cap: stops descending after `SCRUB_MAX_NODES` visited containers and
 *   copies the remaining subtree by reference unscrubbed (bounded nesting-bomb
 *   defense; real metadata is shallow). String leaves are still scrubbed past
 *   the cap because `scrubSecrets` is O(constant) under the size guard.
 * - Plain-object guard: only `isPlainObject` (prototype `Object.prototype` or
 *   null) and arrays are descended; `Date`/`RegExp`/class instances are copied
 *   by reference. This also defeats prototype-pollution payloads — a
 *   `__proto__`-tampered object is not plain, so it is never walked.
 *
 * Used by `validateMetadata` so a secret buried in a nested allow-listed value
 * (e.g. `backend.error.caught.stack_brief`,
 * `aimock.match.decision.reject_reasons`) cannot bypass the top-level scrub.
 */
export function scrubDeep(value: unknown): unknown {
  if (typeof value === "string") return scrubSecrets(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return value;

  // Maps each ORIGINAL container to its fresh COPY: doubles as the cycle guard
  // (a container already mapped is never re-walked) and the sharing dedupe.
  const copies = new WeakMap<Container, Container>();
  let visited = 0;

  // Make (or reuse) the fresh container for an original container.
  const freshFor = (original: Container): Container => {
    const existing = copies.get(original);
    if (existing !== undefined) return existing;
    const fresh: Container = Array.isArray(original) ? [] : {};
    copies.set(original, fresh);
    return fresh;
  };

  const root = value as Container;
  const rootCopy = freshFor(root);
  // Work items: copy children of `original` into `copy`.
  const stack: Array<{ original: Container; copy: Container }> = [
    { original: root, copy: rootCopy },
  ];

  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const { original, copy } = item;
    visited += 1;

    const assign = (key: string | number, child: unknown): void => {
      // Beyond the node cap: copy the remaining subtree BY REFERENCE (degraded
      // but safe; bounded). Strings are still scrubbed (cheap, O(constant)).
      if (visited > SCRUB_MAX_NODES) {
        (copy as Record<string | number, unknown>)[key] =
          typeof child === "string" ? scrubSecrets(child) : child;
        return;
      }
      if (typeof child === "string") {
        (copy as Record<string | number, unknown>)[key] = scrubSecrets(child);
      } else if (Array.isArray(child) || isPlainObject(child)) {
        const childContainer = child as Container;
        const alreadySeen = copies.has(childContainer);
        const childCopy = freshFor(childContainer);
        (copy as Record<string | number, unknown>)[key] = childCopy;
        if (!alreadySeen) {
          stack.push({ original: childContainer, copy: childCopy });
        }
      } else {
        // number / boolean / null / function / Date / RegExp / class instance:
        // copy by reference, unscrubbed (never mutate the caller's leaf).
        (copy as Record<string | number, unknown>)[key] = child;
      }
    };

    if (Array.isArray(original)) {
      for (let i = 0; i < original.length; i += 1) assign(i, original[i]);
    } else {
      for (const key of Object.keys(original)) assign(key, original[key]);
    }
  }
  return rootCopy;
}
