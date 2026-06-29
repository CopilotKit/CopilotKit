import { NextResponse } from "next/server";

// Abuse controls for the public HITL approval endpoint
// (/api/openbox/approvals/decide). This demo is a single shared public
// instance with no user accounts, and the OpenBox SDK's approval `decide()`
// takes only an opaque, Core-issued governanceEventId — there is no session or
// owner to bind against. These guards are pragmatic protection against
// cross-site and drive-by abuse; they are NOT a substitute for real
// authentication. See the README "Security" section for how to lock this down
// in production.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const PRUNE_THRESHOLD = 5_000;

const buckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Same-origin guard. Rejects only on positive evidence of a cross-site
 * request (a cross-site `Sec-Fetch-Site`, or an `Origin` whose host differs
 * from the request host). When those signals are absent we allow the request,
 * so legitimate same-origin browser fetches are never blocked.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (
    site &&
    site !== "same-origin" &&
    site !== "same-site" &&
    site !== "none"
  ) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("host");
    try {
      if (host && new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Optional operator token. Open by default so the public demo works with no
 * configuration. When `OPENBOX_APPROVAL_TOKEN` is set, every request must send
 * a matching `x-openbox-approval-token` header — which locks out the anonymous
 * browser flow by design (see README).
 */
export function hasValidOperatorToken(request: Request): boolean {
  const required = process.env.OPENBOX_APPROVAL_TOKEN;
  if (!required) return true;
  return request.headers.get("x-openbox-approval-token") === required;
}

/** Best-effort per-IP rate limit. Per-instance only (in-memory). */
export function withinRateLimit(request: Request): boolean {
  const now = Date.now();
  const ip = clientIp(request);

  if (buckets.size > PRUNE_THRESHOLD) {
    for (const [key, bucket] of buckets) {
      if (now > bucket.resetAt) buckets.delete(key);
    }
  }

  const bucket = buckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

/**
 * Runs all approval-endpoint guards in order. Returns a `NextResponse` to
 * short-circuit the request, or `null` when it may proceed.
 */
export function enforceApprovalGuards(request: Request): NextResponse | null {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  if (!hasValidOperatorToken(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  if (!withinRateLimit(request)) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Slow down and try again." },
      { status: 429 },
    );
  }

  return null;
}
