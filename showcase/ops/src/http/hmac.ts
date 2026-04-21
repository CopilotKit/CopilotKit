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
    | "invalid-timestamp"
    | "invalid-signature-format";
}

/**
 * NOTE: The canonical payload `path` MUST be the request path observed by
 * the server (e.g. derived from `c.req.path`), NOT a route constant. The
 * matching signer lives in .github/workflows/showcase_deploy.yml — if the
 * route is ever renamed, the workflow signer must move in lockstep or
 * signatures will silently fail.
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
  if (!timestamp || !signatureHeader) {
    return { ok: false, reason: "missing-headers" };
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
      // Most thrown errors here are length mismatches on malformed hex
      // input (expected), but crypto / Buffer can also throw for
      // genuinely unexpected reasons (OOM, odd platform quirks). Log at
      // debug so operators can grep when a sender starts failing for a
      // non-obvious reason.
      input.logger?.debug("hmac.verify.compare-error", {
        err: String(err),
      });
    }
  }
  return { ok: false, reason: "bad-signature" };
}
