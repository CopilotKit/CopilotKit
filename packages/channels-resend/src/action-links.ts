import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Query parameter that carries a signed action token. */
export const ACTION_PARAM = "ck_action";

/** Default lifetime of an action link: 7 days. */
export const DEFAULT_ACTION_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What one signed link asks for. */
export interface ActionLinkClaims {
  /** The minted action id of the control. */
  actionId: string;
  /** The control's value (a button `value`, or one select option). */
  value?: unknown;
  /** The conversation the email belongs to. Core only runs the action there. */
  conversationKey: string;
  /** The address the email was sent to. Becomes the interaction actor. */
  recipient: string;
  /** Expiry, in milliseconds since the epoch. */
  expiresAt: number;
  /** Random id. A link works once. */
  nonce: string;
  /** The control's label, for the confirmation page. */
  label: string;
}

interface WirePayload {
  a: string;
  v?: unknown;
  k: string;
  r: string;
  e: number;
  n: string;
  l: string;
}

const SIGNING_PREFIX = "ck-resend-action.v1.";

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret)
    .update(SIGNING_PREFIX + payload)
    .digest("base64url");
}

/** Create a signed token for one control. */
export function signActionLink(
  secret: string,
  claims: Omit<ActionLinkClaims, "nonce"> & { nonce?: string },
): string {
  const wire: WirePayload = {
    a: claims.actionId,
    ...(claims.value !== undefined ? { v: claims.value } : {}),
    k: claims.conversationKey,
    r: claims.recipient,
    e: claims.expiresAt,
    n: claims.nonce ?? randomBytes(12).toString("base64url"),
    l: claims.label,
  };
  const payload = Buffer.from(JSON.stringify(wire)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

/** Build the full URL for a token. Keeps any query the base URL already has. */
export function actionLinkUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set(ACTION_PARAM, token);
  return url.toString();
}

export type ActionLinkResult =
  | { ok: true; claims: ActionLinkClaims }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

/**
 * Check a token's signature and expiry. The signature covers the whole
 * payload (action id, value, conversation, recipient, expiry, nonce), so
 * none of them can be changed. Replays are stopped by the caller, which
 * records each nonce once it is used.
 */
export function verifyActionLink(
  secret: string,
  token: string,
  now = Date.now(),
): ActionLinkResult {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) {
    return { ok: false, reason: "malformed" };
  }
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(secret, payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad-signature" };
  }
  let wire: WirePayload;
  try {
    wire = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof wire !== "object" ||
    wire === null ||
    typeof wire.a !== "string" ||
    typeof wire.k !== "string" ||
    typeof wire.r !== "string" ||
    typeof wire.e !== "number" ||
    typeof wire.n !== "string" ||
    typeof wire.l !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (wire.e <= now) return { ok: false, reason: "expired" };
  return {
    ok: true,
    claims: {
      actionId: wire.a,
      ...("v" in wire ? { value: wire.v } : {}),
      conversationKey: wire.k,
      recipient: wire.r,
      expiresAt: wire.e,
      nonce: wire.n,
      label: wire.l,
    },
  };
}
