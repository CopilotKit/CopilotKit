import {
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import type { JsonWebKey, KeyObject } from "node:crypto";

/** Google's public keys for OIDC tokens, including Pub/Sub push tokens. */
export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
/** Allowed clock difference when checking `exp` and `iat`. */
const CLOCK_SKEW_S = 300;
/** Do not fetch the keys again for an unknown `kid` more often than this. */
const MIN_REFETCH_MS = 60_000;
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000;

/** Why a push request was rejected. */
export class PushAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushAuthError";
  }
}

/** The Gmail notification inside a Pub/Sub push. */
export interface GmailNotification {
  emailAddress: string;
  historyId: string;
  /** Pub/Sub message id. */
  pubsubMessageId: string;
}

export interface OidcOptions {
  audience: string;
  serviceAccountEmail?: string;
}

/** Google's signing keys, cached for as long as Google's `max-age` says. */
export class GoogleKeys {
  private keys = new Map<string, KeyObject>();
  private expiresAt = 0;
  private fetchedAt = 0;
  private pending: Promise<void> | undefined;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async get(kid: string): Promise<KeyObject | undefined> {
    if (this.now() >= this.expiresAt) await this.load();
    const key = this.keys.get(kid);
    if (key) return key;
    // Google rotates keys. Fetch again for an unknown kid, but not in a loop.
    if (this.now() - this.fetchedAt >= MIN_REFETCH_MS) {
      await this.load();
      return this.keys.get(kid);
    }
    return undefined;
  }

  private load(): Promise<void> {
    this.pending ??= this.fetchKeys().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async fetchKeys(): Promise<void> {
    const res = await this.fetchImpl(GOOGLE_CERTS_URL);
    if (!res.ok) {
      throw new PushAuthError(`could not fetch Google keys (${res.status})`);
    }
    const body = (await res.json()) as {
      keys?: Array<JsonWebKey & { kid?: string }>;
    };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || jwk.kty !== "RSA") continue;
      keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
    }
    const maxAge = /max-age=(\d+)/.exec(
      res.headers.get("cache-control") ?? "",
    )?.[1];
    this.keys = keys;
    this.fetchedAt = this.now();
    this.expiresAt =
      this.now() + (maxAge ? Number(maxAge) * 1000 : DEFAULT_KEYS_TTL_MS);
  }
}

function decodeJson(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(
    Buffer.from(segment, "base64url").toString("utf8"),
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("not an object");
  }
  return value as Record<string, unknown>;
}

/**
 * Verify the OIDC token Pub/Sub sends on an authenticated push. Checks the
 * RS256 signature against Google's keys, the issuer, the audience, the
 * expiry, and (when configured) the signing service account.
 */
export async function verifyOidcToken(
  authorization: string | null,
  opts: OidcOptions,
  keys: GoogleKeys,
  now: () => number = Date.now,
): Promise<void> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (!token) throw new PushAuthError("missing bearer token");
  const segments = token.split(".");
  if (segments.length !== 3) throw new PushAuthError("malformed token");
  const [head, body, sig] = segments as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decodeJson(head);
    claims = decodeJson(body);
  } catch {
    throw new PushAuthError("malformed token");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new PushAuthError("unsupported token algorithm");
  }
  const key = await keys.get(header.kid);
  if (!key) throw new PushAuthError("unknown signing key");
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    key,
    Buffer.from(sig, "base64url"),
  );
  if (!valid) throw new PushAuthError("bad signature");
  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) {
    throw new PushAuthError("wrong issuer");
  }
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(opts.audience)) {
    throw new PushAuthError("wrong audience");
  }
  const nowS = Math.floor(now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < nowS) {
    throw new PushAuthError("token expired");
  }
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_S > nowS) {
    throw new PushAuthError("token issued in the future");
  }
  if (opts.serviceAccountEmail !== undefined) {
    const verified =
      claims.email_verified === true || claims.email_verified === "true";
    if (claims.email !== opts.serviceAccountEmail || !verified) {
      throw new PushAuthError("wrong service account");
    }
  }
}

/** Compare the `token` query parameter with the shared token, in constant time. */
export function verifySharedToken(url: URL, expected: string): void {
  const given = Buffer.from(url.searchParams.get("token") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new PushAuthError("bad verification token");
  }
}

/** Parse a Pub/Sub push body into the Gmail notification it carries. */
export function parsePushBody(body: unknown): GmailNotification | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const message = (body as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return undefined;
  const { data, messageId, message_id } = message as Record<string, unknown>;
  if (typeof data !== "string") return undefined;
  let inner: Record<string, unknown>;
  try {
    // Pub/Sub sends standard base64; Node's decoder also takes base64url.
    inner = decodeJson(data);
  } catch {
    return undefined;
  }
  const historyId =
    typeof inner.historyId === "number"
      ? String(inner.historyId)
      : inner.historyId;
  if (
    typeof inner.emailAddress !== "string" ||
    typeof historyId !== "string" ||
    !/^\d+$/.test(historyId)
  ) {
    return undefined;
  }
  const id = messageId ?? message_id;
  return {
    emailAddress: inner.emailAddress.toLowerCase(),
    historyId,
    pubsubMessageId: typeof id === "string" ? id : "",
  };
}
