import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { seoRedirects } from "@/lib/seo-redirects";
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

const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

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

// Framework slugs owned by the new `/<framework>/<...slug>` catch-all
// route. Any path whose first segment matches one of these is a
// first-class framework-scoped docs URL — the SEO-redirect table must
// NOT hijack it even when the legacy framework keys (`mastra`,
// `agno`, `llamaindex`, `pydantic-ai`, `ag2`) overlap with registry
// slugs. Concretely: `/mastra/agentic-chat-ui` is the new docs URL,
// not a legacy SEO path.
const REGISTRY_FRAMEWORK_SLUGS: Set<string> = new Set(
  (registry as { integrations?: { slug: string }[] }).integrations?.map(
    (i) => i.slug,
  ) ?? [],
);

function pathIsFrameworkScoped(pathname: string): boolean {
  const first = pathname.split("/").filter(Boolean)[0];
  return Boolean(first) && REGISTRY_FRAMEWORK_SLUGS.has(first);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Short-circuit: paths owned by the framework-scoped docs route
  // should never be touched by the SEO-redirect table. This prevents
  // legacy redirects (e.g. `/mastra/agentic-chat-ui` →
  // `/docs/integrations/mastra/prebuilt-components`) from fighting the
  // new catch-all, which wants `/mastra/agentic-chat-ui` to render the
  // Mastra-scoped Agentic Chat UI docs in place.
  if (pathIsFrameworkScoped(pathname)) {
    return NextResponse.next();
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
