/**
 * ab-hmac.ts — HMAC guard for the CVDIAG "Railway-internal routing A/B"
 * (flap-observability spec Phase 8). The A/B's optional second probe run
 * targets the backend over Railway's INTERNAL network, bypassing the public
 * edge, so the two outcomes can be diffed to detect edge-layer interference
 * (Cloudflare-WAF-style). Because that internal request skips the edge's auth
 * surface, it carries a self-authenticating HMAC so the backend (and the
 * PB-writer path) can reject a forged / replayed A/B probe.
 *
 * CONTRACT:
 *   - The signed message is the canonical tuple `<test_id>|<ts>|<slug>` joined
 *     by a literal `|` (a delimiter that cannot appear in a UUIDv7 test_id, an
 *     integer ms timestamp, or a `^[a-z0-9-]+$` slug — so the tuple parse is
 *     unambiguous and no field can smuggle a `|` to forge a different tuple).
 *   - The key is read from the `CVDIAG_AB_HMAC_SECRET` env var, which is
 *     populated from a 1Password item via an `op://` reference at deploy time
 *     (see AB_INTERNAL_ROUTING design note). The plaintext secret NEVER appears
 *     in source or in a commit — only the env-var NAME does.
 *   - `test_id` is SANITIZED (must be a well-formed lowercase UUIDv7) before it
 *     is signed or verified; a malformed test_id fails closed (no signature is
 *     produced, verification returns false). This prevents an attacker-chosen
 *     test_id from poisoning the corpus or the cross-layer join key.
 *   - Verification is CONSTANT-TIME (`crypto.timingSafeEqual` over equal-length
 *     digests) so a partial-match timing side channel cannot be used to forge a
 *     signature byte-by-byte.
 *
 * Pure crypto helper: no I/O, no logging of secret material. A missing secret
 * is a hard verification failure (fail-closed), never a silent allow.
 */

import crypto from "node:crypto";

import { isValidTestId } from "./schema.js";

/** Env var carrying the shared HMAC secret (sourced from `op://` at deploy). */
export const CVDIAG_AB_HMAC_SECRET_ENV = "CVDIAG_AB_HMAC_SECRET";

/** Canonical field delimiter for the signed tuple. */
const FIELD_DELIMITER = "|";

/** HMAC digest algorithm. */
const HMAC_ALGO = "sha256";

/** The tuple that is signed / verified. */
export interface AbSignedTuple {
  /** Lowercase UUIDv7; sanitized before use. */
  testId: string;
  /** Integer epoch-ms timestamp at sign time. */
  ts: number;
  /** Backend slug (`^[a-z0-9-]+$`). */
  slug: string;
}

/**
 * Sanitize a candidate `test_id`. Returns the normalized lowercase UUIDv7 when
 * valid, or `null` when malformed (fail-closed — the caller must NOT sign or
 * verify an unsanitized id). Normalization lowercases before the UUIDv7 check
 * so a mixed-case but otherwise valid id is accepted in canonical form.
 */
export function sanitizeTestId(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const normalized = candidate.trim().toLowerCase();
  return isValidTestId(normalized) ? normalized : null;
}

/**
 * Build the canonical signing message for the tuple. Returns `null` when the
 * `test_id` fails sanitization or any field is structurally invalid (non-finite
 * / non-integer ts, empty slug, a `|` smuggled into the slug). Fail-closed: a
 * null here means no signature is produced and verification rejects.
 */
export function canonicalAbMessage(tuple: AbSignedTuple): string | null {
  const testId = sanitizeTestId(tuple.testId);
  if (testId === null) return null;
  if (!Number.isInteger(tuple.ts) || tuple.ts < 0) return null;
  if (typeof tuple.slug !== "string" || tuple.slug.length === 0) return null;
  // A delimiter inside any field would make the tuple parse ambiguous; the
  // UUIDv7 test_id and integer ts cannot contain one, but guard the slug.
  if (tuple.slug.includes(FIELD_DELIMITER)) return null;
  return [testId, String(tuple.ts), tuple.slug].join(FIELD_DELIMITER);
}

/**
 * Read the shared secret from the environment. Returns the secret string, or
 * `null` when unset/empty (fail-closed). Never logs the value.
 */
export function resolveAbHmacSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env[CVDIAG_AB_HMAC_SECRET_ENV];
  if (raw === undefined || raw === null || raw === "") return null;
  return raw;
}

/**
 * Sign the tuple, returning the lowercase-hex HMAC-SHA256 digest, or `null`
 * when the secret is unset or the tuple fails sanitization (fail-closed — the
 * caller must treat a null signature as "do not issue the A/B request").
 */
export function signAbRequest(
  tuple: AbSignedTuple,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = resolveAbHmacSecret(env);
  if (secret === null) return null;
  const message = canonicalAbMessage(tuple);
  if (message === null) return null;
  return crypto
    .createHmac(HMAC_ALGO, secret)
    .update(message, "utf8")
    .digest("hex");
}

/**
 * Verify a presented signature against the tuple, in constant time. Returns
 * `false` (fail-closed) when:
 *   - the secret is unset,
 *   - the tuple fails sanitization,
 *   - the presented signature is malformed (not lowercase hex of the right
 *     length), or
 *   - the digests do not match.
 *
 * The constant-time compare runs only over equal-length buffers (a length
 * mismatch short-circuits to `false` BEFORE `timingSafeEqual`, which throws on
 * unequal lengths). The PB-writer A/B path MUST reject (skip the write) when
 * this returns false so no row is persisted for an unverified A/B request.
 */
export function verifyAbRequest(
  tuple: AbSignedTuple,
  presentedSignature: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const expected = signAbRequest(tuple, env);
  if (expected === null) return false;
  if (
    typeof presentedSignature !== "string" ||
    presentedSignature.length !== expected.length
  ) {
    return false;
  }
  // Both are lowercase-hex of equal length; compare the decoded bytes in
  // constant time. A non-hex presented string yields a buffer of a different
  // byte length than `expected`, so the length guard below rejects it.
  const expectedBuf = Buffer.from(expected, "hex");
  const presentedBuf = Buffer.from(presentedSignature, "hex");
  if (expectedBuf.length !== presentedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, presentedBuf);
}
