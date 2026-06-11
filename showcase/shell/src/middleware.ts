import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { seoRedirects } from "@/lib/seo-redirects";
import { getRuntimeConfigForMiddleware } from "@/lib/runtime-config";
import {
  resolveDocsHostRedirect,
  resolveSeoDestination,
} from "@/lib/docs-redirects";
import registry from "@/data/registry.json";

// ---------------------------------------------------------------------------
// Build lookup structures at module load (once per cold start)
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

let posthogKeyWarned = false;

function trackRedirect(
  event: NextFetchEvent,
  id: string,
  fromPath: string,
  toPath: string,
): void {
  const apiKey = process.env.POSTHOG_KEY;
  if (!apiKey) {
    if (!posthogKeyWarned) {
      console.warn(
        "[middleware] POSTHOG_KEY is not set — redirect tracking disabled",
      );
      posthogKeyWarned = true;
    }
    return;
  }

  // Read the PostHog host from the Edge-safe runtime config (live
  // process.env at request time, no `next/cache` import — see
  // getRuntimeConfigForMiddleware in src/lib/runtime-config.ts).
  const posthogHost = getRuntimeConfigForMiddleware().posthogHost;

  // Don't await (never block the redirect), but DO hand the promise to
  // event.waitUntil — the Edge runtime may otherwise terminate as soon
  // as the redirect response is returned, dropping the in-flight capture.
  const capture = fetch(`${posthogHost}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
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
  event.waitUntil(capture);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Framework slugs owned by the docs shell. Any path whose first
// segment matches one of these is a framework-scoped docs URL — it
// 308s to the docs host BEFORE the SEO-redirect table runs, so legacy
// redirects (e.g. `/mastra/agentic-chat-ui` →
// `/docs/integrations/mastra/prebuilt-components`) can never hijack it
// even when legacy framework keys overlap with registry slugs.
const REGISTRY_FRAMEWORK_SLUGS: Set<string> = new Set(
  (registry as { integrations?: { slug: string }[] }).integrations?.map(
    (i) => i.slug,
  ) ?? [],
);

/**
 * Loud guard (exported for tests): the old next.config build THREW when
 * registry.json was missing or corrupt in production. Middleware cannot
 * afford to throw at module load — that would 500 every request — so it
 * screams in the logs instead: an empty slug set silently disables every
 * /<framework-slug> docs-host redirect.
 */
export function warnIfNoFrameworkSlugs(slugs: ReadonlySet<string>): void {
  if (slugs.size > 0) return;
  const message =
    "[middleware] registry.json produced ZERO framework slugs — " +
    "/<framework-slug> docs-host redirects are DISABLED. The registry is " +
    "missing or corrupt; run generate-registry.ts before building (the " +
    "old next.config build failed loudly here).";
  if (process.env.NODE_ENV === "production") {
    console.error(message);
  } else {
    console.warn(message);
  }
}

warnIfNoFrameworkSlugs(REGISTRY_FRAMEWORK_SLUGS);

export function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  const docsHost = getRuntimeConfigForMiddleware().docsHost;

  // 0. Docs-host routes (/docs, /ag-ui, /reference, /<framework-slug>).
  // These permanent (308) redirects used to live in next.config.ts
  // `redirects()` (as `permanent: true`, which Next emits as 308) — which
  // runs BEFORE middleware, hence this check sits FIRST to preserve
  // the exact same precedence over the SEO table. They moved here so
  // the destination host resolves from the runtime config (DOCS_HOST
  // env var) at request time instead of being baked into the image.
  const docsDestination = resolveDocsHostRedirect(
    pathname,
    docsHost,
    REGISTRY_FRAMEWORK_SLUGS,
  );
  if (docsDestination) {
    const dest = new URL(docsDestination);
    // next.config redirects forward the query string by default — keep
    // that behavior.
    dest.search = request.nextUrl.search;
    // Parity choice: docs-host redirects are deliberately NOT tracked in
    // PostHog — the next.config `redirects()` rules they replace never
    // were either; only the SEO table below calls trackRedirect.
    //
    // 308, not 301: the old rules used `permanent: true`, which Next
    // emits as 308 (permanent, method-preserving).
    return NextResponse.redirect(dest, 308);
  }

  // 1. Exact match (O(1) Map lookup)
  //
  // The SEO table's destinations target the DOCS routing surface
  // (shell-docs serves at the docs host root), NOT the shell. Resolving
  // them against `request.url` (the shell origin) made self-referential
  // entries (e.g. /faq -> /faq) 301 to themselves forever
  // (ERR_TOO_MANY_REDIRECTS) and sent everything else to a shell 404 or
  // through a needless double hop — so resolve against the docs host.
  const exact = exactMap.get(pathname);
  if (exact) {
    const dest = resolveSeoDestination(exact.destination, docsHost);
    // Forward the query string, matching step 0 (and next.config
    // redirects' default behavior).
    dest.search = request.nextUrl.search;
    trackRedirect(event, exact.id, pathname, dest.pathname);
    return NextResponse.redirect(dest, 301);
  }

  // 2. Wildcard match (linear scan — short-circuits on first match).
  // Destinations resolve against the docs host — see step 1.
  //
  // next.config `:path*` semantics are ZERO or more segments: a source
  // `/x/:path*` also matches the bare `/x` (rest = ""), so e.g.
  // /backend, /guides, /learn keep redirecting instead of 404ing.
  // resolveSeoDestination collapses the trailing slash a zero-segment
  // substitution leaves behind.
  for (const wc of wildcardEntries) {
    const bareSource = wc.prefix.endsWith("/")
      ? wc.prefix.slice(0, -1)
      : wc.prefix;
    if (pathname.startsWith(wc.prefix) || pathname === bareSource) {
      const rest =
        pathname === bareSource ? "" : pathname.slice(wc.prefix.length);
      let destination: string;
      if (wc.destinationTemplate.includes(":path*")) {
        destination = wc.destinationTemplate.replace(":path*", rest);
      } else {
        destination = wc.destinationTemplate;
      }
      const dest = resolveSeoDestination(destination, docsHost);
      dest.search = request.nextUrl.search;
      trackRedirect(event, wc.id, pathname, dest.pathname);
      return NextResponse.redirect(dest, 301);
    }
  }

  // 3. No match — pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on all paths except static assets, API routes, and Next.js
    // internals. Note the trailing slash on `api/`: only real API routes
    // (/api/...) are excluded — the bare /api and prefix lookalikes like
    // /api-reference are SEO sources (R1/R3) and must reach the
    // middleware.
    "/((?!api/|_next/static|_next/image|favicon\\.ico|previews/).*)",
  ],
};
