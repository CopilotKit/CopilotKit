import crypto from "node:crypto";
import type { Logger } from "../types/index.js";

export interface HmacVerifyInput {
  method: string;
  path: string;
  timestamp: string;
  body: string;
  signatureHeader: string;
  secrets: string[];
  /** Allowed clock skew in seconds (default 300). */
  maxSkewSec?: number;
  /** Current epoch seconds; override for tests. */
  nowSec?: () => number;
  /** Optional logger for diagnosing unexpected crypto/decode failures. */
  logger?: Logger;
}

export interface HmacVerifyResult {
  ok: boolean;
  reason?:
    | "stale"
    | "bad-signature"
    | "missing-headers"
    | "missing-timestamp"
    | "missing-signature"
    | "invalid-timestamp"
    | "invalid-signature-format";
}

/**
 * NOTE: the canonical payload `path` MUST be a stable string agreed by the
 * signer AND the verifier. The canonical value is the ROUTE CONSTANT that
 * the handler is mounted at (e.g. `"/webhooks/deploy"`) — NOT `c.req.path`.
 *
 * Rationale: `c.req.path` varies with proxy configuration. A reverse proxy
 * that strips a path prefix, normalizes trailing slashes, or mounts this
 * service at a different base would surface a different observed path to
 * the handler than the one the signer hashed — producing silent
 * signature-verification failures that are painful to diagnose.
 *
 * Canonical contract:
 *   - Signer (`.github/workflows/showcase_deploy.yml`): uses the ROUTE
 *     CONSTANT `"/webhooks/deploy"` as the `path` component.
 *   - Verifier (`src/http/webhooks/deploy.ts`): uses the same route
 *     constant (`deps.webhookPath ?? route`), NOT `c.req.path`.
 *
 * If the route is renamed, BOTH the workflow signer AND the handler's
 * route constant MUST move in lockstep. The override via
 * `deps.webhookPath` exists precisely for the proxy case — callers mount
 * this service behind a rewrite and declare the path the signer used.
 */
export function canonicalPayload(
  method: string,
  path: string,
  timestamp: string,
  body: string,
): string {
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  return `${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}`;
}

export function computeSignature(secret: string, canonical: string): string {
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

export function verifyHmac(input: HmacVerifyInput): HmacVerifyResult {
  // Trim the signature header defensively: some workflow senders / jq
  // invocations accidentally prefix or suffix whitespace (e.g. a trailing
  // newline from `$(…)` substitution). Without trimming we'd fall through
  // to `bad-signature` with no diagnostic, which is painful to debug.
  const signatureHeader = input.signatureHeader?.trim() ?? "";
  const timestamp = input.timestamp?.trim() ?? "";
  // Split the reason codes for missing timestamp vs missing signature
  // so operators can diagnose a signer that forgot one header without
  // reverse-engineering "missing-headers". The legacy `missing-headers`
  // reason is retained for the both-missing case (rare; usually means
  // a middleware stripped both) so existing dashboards keep working.
  if (!timestamp && !signatureHeader) {
    return { ok: false, reason: "missing-headers" };
  }
  if (!timestamp) {
    return { ok: false, reason: "missing-timestamp" };
  }
  if (!signatureHeader) {
    return { ok: false, reason: "missing-signature" };
  }
  // Require an integer — floats like "1700000000.5" are almost certainly
  // a bug on the signer side, and accepting them invites drift around the
  // skew boundary.
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) {
    return { ok: false, reason: "invalid-timestamp" };
  }
  const nowSec = input.nowSec?.() ?? Math.floor(Date.now() / 1000);
  const skew = input.maxSkewSec ?? 300;
  if (Math.abs(nowSec - ts) > skew) return { ok: false, reason: "stale" };
  // Lenient by design: accept both `sha256=<hex>` and a bare `<hex>`
  // string. Sender lint drift / manual curl testing has historically
  // flip-flopped on the prefix, and the canonical message already pins
  // the algorithm to sha256 — there's no security benefit to requiring
  // the prefix. If that changes (e.g. multi-algo support), remove this
  // `replace` and require the prefix explicitly.
  const providedHex = signatureHeader.replace(/^sha256=/, "");
  // Validate the hex shape before reaching for timingSafeEqual — an
  // upstream sender producing non-hex garbage (or base64 by mistake)
  // deserves a distinct reason code so operators can diagnose quickly
  // instead of chasing "bad-signature" for a malformed header.
  if (!/^[0-9a-f]+$/i.test(providedHex) || providedHex.length % 2 !== 0) {
    return { ok: false, reason: "invalid-signature-format" };
  }
  const canonical = canonicalPayload(
    input.method,
    input.path,
    timestamp,
    input.body,
  );
  for (const secret of input.secrets) {
    if (!secret) continue;
    const expected = computeSignature(secret, canonical);
    try {
      if (
        providedHex.length === expected.length &&
        crypto.timingSafeEqual(
          Buffer.from(providedHex, "hex"),
          Buffer.from(expected, "hex"),
        )
      ) {
        return { ok: true };
      }
    } catch (err) {
      // Split error classification: benign length-mismatches (expected on
      // malformed hex) stay at debug to avoid log spam, while genuinely
      // unexpected crypto-layer failures (OOM, platform quirks, bad
      // inputs that slipped past the hex-shape regex) surface at warn
      // with a stable errorId so operators can alert on them and
      // distinguish real breakage from the noisy happy-path rejection.
      const message = err instanceof Error ? err.message : String(err);
      const isLengthMismatch =
        /input buffers must have the same byte length/i.test(message) ||
        /Input buffers must have the same length/i.test(message);
      if (isLengthMismatch) {
        input.logger?.debug("hmac.verify.compare-error", {
          reason: "length-mismatch",
          err: message,
        });
      } else {
        input.logger?.warn("hmac.verify.compare-error", {
          errorId: "HMAC_COMPARE_UNEXPECTED_ERROR",
          err: message,
        });
      }
    }
  }
  return { ok: false, reason: "bad-signature" };
}
