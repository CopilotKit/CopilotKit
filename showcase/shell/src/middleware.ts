import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { seoRedirects } from "@/lib/seo-redirects";

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

const POSTHOG_HOST = "https://eu.i.posthog.com";

let posthogKeyWarned = false;

function trackRedirect(id: string, fromPath: string, toPath: string): void {
  const apiKey = process.env.POSTHOG_PROJECT_KEY;
  if (!apiKey) {
    if (!posthogKeyWarned) {
      console.warn(
        "[middleware] POSTHOG_PROJECT_KEY is not set — redirect tracking disabled",
      );
      posthogKeyWarned = true;
    }
    return;
  }

  // Fire-and-forget — don't await
  fetch(`${POSTHOG_HOST}/capture/`, {
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
