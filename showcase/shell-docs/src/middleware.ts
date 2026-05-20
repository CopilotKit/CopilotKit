import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { seoRedirects } from "@/lib/seo-redirects";
import registry from "@/data/registry.json";

// ---------------------------------------------------------------------------
// shell-docs middleware
//
// Two responsibilities:
//   1. SEO redirects — handle legacy upstream URLs (the old SHELL routing
//      surface, /docs/integrations/*, renamed framework slugs, etc.) by
//      301'ing to the canonical shell-docs path. Source of truth is
//      `seo-redirects.ts`. Tracked in PostHog via the `seo_redirect`
//      event so the decommission report can identify zero-traffic
//      entries.
//   2. Pageview tracking — capture a `docs_pageview` event for every
//      passthrough (non-redirected) request, with a stable
//      first-party-cookie distinct_id.
//
// The redirect table is checked FIRST. If a request matches, we issue
// the 301 and fire `seo_redirect`; we do NOT also fire `docs_pageview`
// for that request (the pageview will be captured on the redirect's
// destination). Otherwise we fall through to pageview tracking.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Build redirect lookup structures at module load (once per cold start)
// ---------------------------------------------------------------------------

/** Exact-match map: source path -> { id, destination } */
const exactMap = new Map<string, { id: string; destination: string }>();

/** Wildcard entries: source has :path* -- stored as { prefix, id, destination } */
const wildcardEntries: {
  prefix: string;
  id: string;
  destinationTemplate: string;
}[] = [];

for (const entry of seoRedirects) {
  const wildcardIdx = entry.source.indexOf(":path*");
  if (wildcardIdx === -1) {
    exactMap.set(entry.source, {
      id: entry.id,
      destination: entry.destination,
    });
  } else {
    const prefix = entry.source.slice(0, wildcardIdx);
    wildcardEntries.push({
      prefix,
      id: entry.id,
      destinationTemplate: entry.destination,
    });
  }
}

// ---------------------------------------------------------------------------
// PostHog tracking via fetch (Edge Runtime compatible — no posthog-node SDK)
// ---------------------------------------------------------------------------

const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
const DISTINCT_ID_COOKIE = "ph_distinct_id";
// ~2 years — long enough to meaningfully track returning visitors.
const DISTINCT_ID_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2;

// Warn once per isolate at module load if the key is missing. Edge runtime
// module globals are per-isolate and short-lived, so a request-scoped
// warn-once flag is unreliable; module-load is the cleanest available hook.
const POSTHOG_KEY = process.env.POSTHOG_KEY;
if (!POSTHOG_KEY) {
  console.warn("[middleware] POSTHOG_KEY is not set — analytics disabled");
}

function trackRedirect(id: string, fromPath: string, toPath: string): void {
  if (!POSTHOG_KEY) {
    return;
  }

  // Fire-and-forget — don't await
  fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: POSTHOG_KEY,
      event: "seo_redirect",
      distinct_id: "seo-redirect-tracker",
      properties: {
        redirect_id: id,
        from_path: fromPath,
        to_path: toPath,
      },
    }),
  }).catch(() => {
    // Silently ignore tracking failures — don't block redirects
  });
}

async function capturePageView(
  pathname: string,
  distinctId: string,
): Promise<void> {
  if (!POSTHOG_KEY) {
    return;
  }

  try {
    const response = await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event: "docs_pageview",
        distinct_id: distinctId,
        properties: {
          path: pathname,
        },
      }),
    });
    // `.catch()` only fires on network-level failures — HTTP 4xx/5xx
    // responses from PostHog resolve normally and would otherwise pass
    // silently. Explicitly surface non-2xx so operators can diagnose
    // auth/project-key/service-outage issues.
    if (!response.ok) {
      console.warn(
        "[middleware] posthog capture non-2xx",
        response.status,
        response.statusText,
      );
    }
  } catch (err) {
    // Surface capture failures (DNS, TLS, connect errors) so operators
    // can diagnose — swallowing errors silently hides real outages.
    console.warn("[middleware] posthog capture failed", err);
  }
}

// ---------------------------------------------------------------------------
// Framework slug short-circuit
//
// shell-docs serves canonical framework docs at /<fw-slug>/<...> using
// the registry slugs (e.g. /langgraph-python/quickstart). A first-class
// framework-scoped URL should fall through to the canonical route
// handler when no explicit catalog rule matches — but explicit catalog
// rules (e.g. slug-rename entries like S3×agno
// /agno/frontend-actions → /agno/frontend-tools) MUST still fire. So
// the catalog is consulted first; only on a catalog miss do we let
// framework-scoped paths bypass the wildcard fallthroughs.
// ---------------------------------------------------------------------------

const REGISTRY_FRAMEWORK_SLUGS: Set<string> = new Set(
  (registry as { integrations?: { slug: string }[] }).integrations?.map(
    (i) => i.slug,
  ) ?? [],
);

function firstSegment(p: string): string | undefined {
  return p.split("/").filter(Boolean)[0];
}

function pathIsFrameworkScoped(pathname: string): boolean {
  const first = firstSegment(pathname);
  return first !== undefined && REGISTRY_FRAMEWORK_SLUGS.has(first);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function middleware(
  request: NextRequest,
  event: NextFetchEvent,
): NextResponse {
  const { pathname } = request.nextUrl;

  // 1. Redirect lookup.
  //
  //   1a. Exact match (O(1) Map lookup) is consulted FIRST for every
  //       request — including framework-scoped paths — so explicit
  //       slug-rename catalog entries fire instead of being shadowed
  //       by the framework short-circuit below.
  const exact = exactMap.get(pathname);
  if (exact && exact.destination !== pathname) {
    trackRedirect(exact.id, pathname, exact.destination);
    return NextResponse.redirect(new URL(exact.destination, request.url), 301);
  }

  //   1b. Wildcard scan. We must avoid letting a too-broad legacy
  //       wildcard (e.g. /coagents/:path*) hijack a canonical
  //       framework-scoped URL (e.g. /langgraph-python/...). For a
  //       framework-scoped request, only allow wildcards whose own
  //       prefix is rooted in the SAME framework slug — those are
  //       same-framework rewrites (e.g. /agno/concepts/:path* →
  //       /agno) and are explicitly authored to fire. Wildcards
  //       whose prefix is a different framework slug, or has no
  //       framework slug at all, are skipped.
  const requestFw = pathIsFrameworkScoped(pathname)
    ? firstSegment(pathname)
    : undefined;

  for (const wc of wildcardEntries) {
    if (!pathname.startsWith(wc.prefix)) {
      continue;
    }
    if (requestFw !== undefined) {
      const wcFw = firstSegment(wc.prefix);
      if (wcFw !== requestFw) {
        continue;
      }
    }
    const rest = pathname.slice(wc.prefix.length);
    let destination: string;
    if (wc.destinationTemplate.includes(":path*")) {
      destination = wc.destinationTemplate.replace(":path*", rest);
    } else {
      destination = wc.destinationTemplate;
    }
    // Defense-in-depth: skip if the wildcard expansion produced a
    // destination identical to the source. Catches catalog drift
    // (e.g. a future entry where source and destination templates
    // resolve to the same path) before it 301-loops.
    if (destination === pathname) {
      continue;
    }
    trackRedirect(wc.id, pathname, destination);
    return NextResponse.redirect(new URL(destination, request.url), 301);
  }

  // 2. Pageview tracking — only on real GET pageviews, not prefetches.
  //
  // Skip non-GET (HEAD, POST, etc.) and Next.js router prefetches —
  // these are not real pageviews and would pollute analytics. Next.js
  // prefetches links via low-priority fetches that still hit middleware,
  // so we filter on both the `next-router-prefetch` header (App Router)
  // and the generic `purpose: prefetch` header.
  if (request.method !== "GET") {
    return NextResponse.next();
  }
  if (request.headers.get("next-router-prefetch") === "1") {
    return NextResponse.next();
  }
  if (request.headers.get("purpose") === "prefetch") {
    return NextResponse.next();
  }
  // Chrome speculation rules (and modern prefetch APIs) advertise
  // prefetches via the `Sec-Purpose` header. Without this filter, the
  // browser's speculative navigations fire phantom pageviews.
  if (request.headers.get("sec-purpose") === "prefetch") {
    return NextResponse.next();
  }

  // Read existing distinct_id cookie, or mint a new one for first-time
  // visitors. The cookie is attached to the response via Set-Cookie.
  const existingDistinctId = request.cookies.get(DISTINCT_ID_COOKIE)?.value;
  const distinctId = existingDistinctId ?? crypto.randomUUID();

  const response = NextResponse.next();

  if (!existingDistinctId) {
    response.cookies.set({
      name: DISTINCT_ID_COOKIE,
      value: distinctId,
      maxAge: DISTINCT_ID_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      // `secure: true` breaks local HTTP dev (the cookie silently
      // refuses to set). Scope to production so dev still exercises the
      // cookie round-trip.
      secure: process.env.NODE_ENV === "production",
      httpOnly: false, // posthog-js on the client may want to read it later
    });
  }

  // waitUntil keeps the Edge execution context alive until the POST
  // resolves, so we don't drop events when NextResponse.next() returns.
  event.waitUntil(capturePageView(pathname, distinctId));

  return response;
}

export const config = {
  matcher: [
    // Skip static assets, Next.js internals, and well-known static paths.
    // Note the trailing `/` on `api/` so this does not match `/apidocs`
    // and friends. The final `(?!.*\\.(png|...)$)` alternative excludes
    // raw asset requests served from /public/** (logos, images, icons,
    // fonts, etc.) — without this, every asset fires a phantom
    // PostHog pageview.
    "/((?!api/|ingest/|_next/static|_next/image|favicon\\.ico|previews/|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|\\.well-known/)(?!.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|avif|woff2?|ttf|otf|eot|map)(?:\\?.*)?$).*)",
  ],
};
