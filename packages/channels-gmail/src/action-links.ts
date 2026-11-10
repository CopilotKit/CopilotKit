import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** Query parameter that carries a signed action. */
export const ACTION_PARAM = "a";
export const DEFAULT_ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What a signed action link carries. */
export interface ActionClaims {
  /** Minted action id (`ck:…`). */
  id: string;
  /** The control's value. Absent when the control has none. */
  value?: unknown;
  /** Gmail thread id the link belongs to. */
  conversationKey: string;
  /** Address the email went to. The click acts as this person. */
  recipient: string;
  /** The control's label, shown on the confirm page. */
  label?: string;
  /** Expiry, in epoch milliseconds. */
  expiresAt: number;
  /** One-time id, so a link can be used once. */
  nonce: string;
}

interface WireClaims {
  i: string;
  v?: unknown;
  c: string;
  r: string;
  l?: string;
  e: number;
  n: string;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Sign an action as one URL query value: `<payload>.<signature>`. The payload
 * is base64url JSON of the action id, value, conversation, recipient, expiry,
 * and a nonce. The signature is HMAC-SHA256 over the payload.
 */
export function signAction(
  secret: string,
  claims: Omit<ActionClaims, "nonce" | "expiresAt">,
  opts: { ttlMs: number; now?: number },
): string {
  const wire: WireClaims = {
    i: claims.id,
    ...(claims.value !== undefined ? { v: claims.value } : {}),
    c: claims.conversationKey,
    r: claims.recipient,
    ...(claims.label ? { l: claims.label.slice(0, 200) } : {}),
    e: (opts.now ?? Date.now()) + opts.ttlMs,
    n: randomUUID(),
  };
  const payload = Buffer.from(JSON.stringify(wire)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export type VerifyResult =
  | { ok: true; claims: ActionClaims }
  | { ok: false; reason: "invalid" | "expired" };

/** Check a signed action. Rejects a bad signature, bad payload, or expired link. */
export function verifyAction(
  secret: string,
  token: string,
  now: number = Date.now(),
): VerifyResult {
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(secret, payload));
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: "invalid" };
  }
  let wire: Partial<WireClaims>;
  try {
    wire = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    typeof wire.i !== "string" ||
    typeof wire.c !== "string" ||
    typeof wire.r !== "string" ||
    typeof wire.e !== "number" ||
    typeof wire.n !== "string"
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (wire.e <= now) return { ok: false, reason: "expired" };
  return {
    ok: true,
    claims: {
      id: wire.i,
      ...("v" in wire ? { value: wire.v } : {}),
      conversationKey: wire.c,
      recipient: wire.r,
      ...(typeof wire.l === "string" ? { label: wire.l } : {}),
      expiresAt: wire.e,
      nonce: wire.n,
    },
  };
}

/** The link for a signed action on the adapter handler. */
export function actionUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set(ACTION_PARAM, token);
  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A small, self-contained HTML page. */
export function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1f2328;line-height:1.5">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${body}
</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
  });
}

/**
 * The page a link opens. It does not run the action: it shows a button that
 * posts the same token. Mail scanners open links in email to check them, so a
 * link that acted on open would act for the scanner and then be spent.
 */
export function confirmPage(token: string, label: string): Response {
  return page(
    "Confirm your choice",
    `<p>${escapeHtml(label)}</p>
<form method="post">
<input type="hidden" name="${ACTION_PARAM}" value="${escapeHtml(token)}">
<button type="submit" style="font-size:16px;padding:10px 20px;border-radius:6px;border:0;background:#1f6feb;color:#fff;cursor:pointer">Confirm</button>
</form>`,
  );
}
