import { createHmac, timingSafeEqual } from "node:crypto";

/** How far a webhook timestamp may drift from now, in seconds (Svix's own default). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookVerifyResult =
  | { ok: true; id: string; timestamp: number }
  | { ok: false; reason: string };

export interface VerifyWebhookArgs {
  /** The signing secret from the Resend dashboard (`whsec_...`). */
  secret: string;
  /** Request headers. Reads `svix-*` headers, or `webhook-*` as a fallback. */
  headers: Headers;
  /** The raw request body, exactly as received. */
  body: string;
  /** Allowed clock drift in seconds. Defaults to {@link WEBHOOK_TOLERANCE_SECONDS}. */
  toleranceSeconds?: number;
  /** Current time in milliseconds. Tests set it. */
  now?: number;
}

function header(headers: Headers, name: string): string | null {
  return headers.get(`svix-${name}`) ?? headers.get(`webhook-${name}`);
}

/** Decode a `whsec_<base64>` secret into the HMAC key. */
export function decodeWebhookSecret(secret: string): Buffer {
  const encoded = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  return Buffer.from(encoded, "base64");
}

/** Sign one webhook message the way Svix does. Returns the base64 signature. */
export function signWebhook(
  secret: string,
  id: string,
  timestamp: number | string,
  body: string,
): string {
  return createHmac("sha256", decodeWebhookSecret(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verify a Resend webhook. Resend signs webhooks with Svix:
 * `base64(HMAC-SHA256(secret, "<svix-id>.<svix-timestamp>.<body>"))`.
 *
 * The `svix-signature` header holds one or more space-separated
 * `v1,<signature>` entries (more than one while a secret is being rotated).
 * Any matching `v1` entry passes. The timestamp must be within the
 * tolerance, in either direction, so an old captured request cannot be
 * replayed.
 */
export function verifyWebhook(args: VerifyWebhookArgs): WebhookVerifyResult {
  const id = header(args.headers, "id");
  const timestampHeader = header(args.headers, "timestamp");
  const signatureHeader = header(args.headers, "signature");
  if (!id || !timestampHeader || !signatureHeader) {
    return { ok: false, reason: "missing signature headers" };
  }
  if (!/^\d+$/.test(timestampHeader)) {
    return { ok: false, reason: "invalid timestamp" };
  }
  const timestamp = Number(timestampHeader);
  const nowSeconds = Math.floor((args.now ?? Date.now()) / 1000);
  const tolerance = args.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }
  const expected = signWebhook(args.secret, id, timestampHeader, args.body);
  for (const entry of signatureHeader.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma < 0) continue;
    const version = entry.slice(0, comma);
    const signature = entry.slice(comma + 1);
    if (version === "v1" && safeEqual(signature, expected)) {
      return { ok: true, id, timestamp };
    }
  }
  return { ok: false, reason: "no matching signature" };
}
