/**
 * Runtime proxy for the showcase-harness ops HTTP API.
 *
 * The Status tab fetches `/api/ops/*` as a same-origin path (see
 * `src/lib/ops-api.ts`). This Route Handler forwards those requests, at
 * REQUEST time, to the harness at `${OPS_BASE_URL}/api/*`.
 *
 * Why a Route Handler and not a `next.config.ts` rewrite:
 *   `rewrites()` is evaluated by `next build` and frozen into the prebuilt
 *   Docker image. The shared CI build bakes a placeholder (`http://ops.invalid`)
 *   to satisfy the build, so every deploy of the single `:latest` image
 *   proxied to a dead host regardless of its runtime `OPS_BASE_URL`. By
 *   reading `process.env.OPS_BASE_URL` inside the handler — forced dynamic so
 *   Next.js never statically caches it — each Railway environment resolves its
 *   own harness URL from the same image, with no rebuild.
 *
 * Same-origin (vs. a direct cross-origin browser call) is still required
 * because the harness has no CORS allowlist, and it keeps the harness URL
 * out of the client bundle.
 *
 * Path mapping: the client calls `/api/ops/probes`, which arrives here as
 * `path = ["probes"]` and is proxied to `${OPS_BASE_URL}/api/probes`. The
 * harness serves its endpoints under `/api/*`, so the proxied prefix is a
 * single `/api` — never doubled, never dropped.
 */
import type { NextRequest } from "next/server";

// Read OPS_BASE_URL per request from the live process env. force-dynamic +
// revalidate 0 guarantee this handler is never statically optimized or
// cached, so the value is resolved at runtime on every request rather than
// frozen at build time.
export const dynamic = "force-dynamic";
export const revalidate = 0;
// The handler proxies arbitrary harness routes (incl. POST trigger) and must
// run on the Node.js runtime so it can read the full process env.
export const runtime = "nodejs";

/**
 * Resolve the harness base URL from the runtime env. Returns `null` (rather
 * than throwing, as the old build-time guard did) so the handler can answer
 * with a clear 503 instead of crashing the request — the wiring bug is then
 * visible in the response, not a build failure.
 */
function resolveOpsBaseUrl(): string | null {
  // Read the non-public `OPS_BASE_URL` only. The `NEXT_PUBLIC_*`-prefixed
  // alternate is intentionally NOT consulted here: it is banned in shell
  // source by the `copilotkit/no-public-env-shell-read` oxlint rule (a
  // `NEXT_PUBLIC_*` read is the build-freeze footgun this whole change
  // exists to remove). `OPS_BASE_URL` is the canonical runtime var per
  // showcase/RAILWAY.md and runtime-config.ts.
  const raw = process.env.OPS_BASE_URL;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Strip trailing slashes so we never produce `https://host//api/...`
  // (some servers reject the double slash). Mirrors the normalization in
  // `src/lib/ops-api.ts:resolveBaseUrl`.
  return trimmed.replace(/\/+$/, "");
}

/**
 * Build the upstream harness URL for an incoming `/api/ops/*` request.
 * `pathSegments` is the `[...path]` capture (e.g. `["probes", "<id>"]`),
 * which maps to `${base}/api/<segments>` plus the original query string.
 */
function buildUpstreamUrl(
  base: string,
  pathSegments: string[],
  search: string,
): string {
  const encoded = pathSegments
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/api/${encoded}${search}`;
}

// Hop-by-hop and host-specific headers must NOT be forwarded to the upstream
// (host would point fetch at the wrong origin; connection/length are managed
// by the fetch/runtime layer). Everything else (content-type, accept,
// authorization, etc.) is forwarded so the trigger token and JSON negotiation
// reach the harness intact.
const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
]);

// Strip the upstream's content-encoding/length when relaying back — `fetch`
// has already decoded the body, so re-advertising the original encoding would
// corrupt the client-visible response.
const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

async function proxy(
  req: NextRequest,
  pathSegments: string[],
): Promise<Response> {
  const base = resolveOpsBaseUrl();
  if (!base) {
    return Response.json(
      {
        error:
          "OPS_BASE_URL is not set on this deploy — the ops proxy cannot reach " +
          "showcase-harness. Set OPS_BASE_URL on the Railway service (see " +
          "showcase/RAILWAY.md).",
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const upstreamUrl = buildUpstreamUrl(base, pathSegments, url.search);

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  // GET/HEAD requests must not carry a body. For other methods, stream the
  // incoming body through to the harness (covers the POST trigger payload).
  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      // Never let Next.js or the platform cache the proxied response — the
      // Status tab polls live data and must see current harness state.
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    // Upstream unreachable (DNS/connection failure). Surface a 502 with the
    // target so the failure is attributable instead of a generic 500.
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `ops proxy failed to reach ${upstreamUrl}: ${message}` },
      { status: 502 },
    );
  }

  // Relay the upstream status + body, copying through headers except the
  // encoding/length ones that fetch has already resolved.
  const responseHeaders = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path);
}
