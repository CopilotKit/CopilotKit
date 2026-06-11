import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { seoRedirects } from "@/lib/seo-redirects";
import { getRuntimeConfigForMiddleware } from "@/lib/runtime-config";
import { resolveDocsHostRedirect } from "@/lib/docs-redirects";
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

function trackRedirect(id: string, fromPath: string, toPath: string): void {
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

  // Fire-and-forget — don't await
  fetch(`${posthogHost}/capture/`, {
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
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Framework slugs owned by the docs shell. Any path whose first
// segment matches one of these is a framework-scoped docs URL — it
// 301s to the docs host BEFORE the SEO-redirect table runs, so legacy
// redirects (e.g. `/mastra/agentic-chat-ui` →
// `/docs/integrations/mastra/prebuilt-components`) can never hijack it
// even when legacy framework keys overlap with registry slugs.
const REGISTRY_FRAMEWORK_SLUGS: Set<string> = new Set(
  (registry as { integrations?: { slug: string }[] }).integrations?.map(
    (i) => i.slug,
  ) ?? [],
);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 0. Docs-host routes (/docs, /ag-ui, /reference, /<framework-slug>).
  // These 301s used to live in next.config.ts `redirects()` — which
  // runs BEFORE middleware, hence this check sits FIRST to preserve
  // the exact same precedence over the SEO table. They moved here so
  // the destination host resolves from the runtime config (DOCS_HOST
  // env var) at request time instead of being baked into the image.
  const docsDestination = resolveDocsHostRedirect(
    pathname,
    getRuntimeConfigForMiddleware().docsHost,
    REGISTRY_FRAMEWORK_SLUGS,
  );
  if (docsDestination) {
    const dest = new URL(docsDestination);
    // next.config redirects forward the query string by default — keep
    // that behavior.
    dest.search = request.nextUrl.search;
    return NextResponse.redirect(dest, 301);
  }

  // 1. Exact match (O(1) Map lookup)
  const exact = exactMap.get(pathname);
  if (exact) {
    trackRedirect(exact.id, pathname, exact.destination);
    return NextResponse.redirect(new URL(exact.destination, request.url), 301);
  }

  // 2. Wildcard match (linear scan — short-circuits on first match)
  for (const wc of wildcardEntries) {
    if (pathname.startsWith(wc.prefix)) {
      const rest = pathname.slice(wc.prefix.length);
      let destination: string;
      if (wc.destinationTemplate.includes(":path*")) {
        destination = wc.destinationTemplate.replace(":path*", rest);
      } else {
        destination = wc.destinationTemplate;
      }
      trackRedirect(wc.id, pathname, destination);
      return NextResponse.redirect(new URL(destination, request.url), 301);
    }
  }

  // 3. No match — pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on all paths except static assets, API routes, and Next.js internals
    "/((?!api|_next/static|_next/image|favicon\\.ico|previews/).*)",
  ],
};
