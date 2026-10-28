import { NextResponse, type NextRequest } from "next/server";
import { trackRedirect } from "@/lib/telemetry/proxy";
import { findSeoRedirect } from "./seo-redirects";

// The redirect half of showcase/shell-docs/src/middleware.ts, for src/proxy.ts.
// Each redirect reports `seo_redirect` as shell-docs did; the page-view and
// raw-text events are reported by src/proxy.ts.

// shell-docs' middleware matcher: no API routes, PostHog proxy, Next
// internals, well-known files, or static assets. v2's proxy has no matcher,
// so the same exclusion gates the redirects here. It matters for route-group
// stripping: Next's own chunk paths can carry `(group)` segments.
const REDIRECTABLE_PATH =
  /^\/(?!api\/|ingest\/|_next\/static|_next\/image|favicon\.ico|previews\/|robots\.txt|sitemap\.xml|manifest\.webmanifest|\.well-known\/)(?!.*\.(?:png|jpg|jpeg|svg|gif|webp|ico|avif|woff2?|ttf|otf|eot|map)(?:\?.*)?$).*/;

function stripRouteGroupSegments(pathname: string): string {
  const clean = pathname
    .split("/")
    .filter((segment) => segment.length > 0 && !/^\(.+\)$/.test(segment));
  return `/${clean.join("/")}`;
}

/**
 * A 301 for a legacy docs.copilotkit.ai URL, or null. Runs after the
 * next.config redirects, as shell-docs' middleware did.
 */
export function legacyRedirect(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!REDIRECTABLE_PATH.test(pathname)) return null;

  // Content route-group folders (`(root)`, `(other)`) leaked into URLs.
  const routeGroupFree = stripRouteGroupSegments(pathname);
  if (routeGroupFree !== pathname) {
    trackRedirect("route-group-strip", pathname, routeGroupFree);
    const url = request.nextUrl.clone();
    url.pathname = routeGroupFree;
    return NextResponse.redirect(url, 301);
  }

  const seo = findSeoRedirect(pathname);
  if (seo) {
    trackRedirect(seo.id, pathname, seo.destination);
    // Like shell-docs, the destination doesn't carry the query string.
    return NextResponse.redirect(new URL(seo.destination, request.url), 301);
  }

  return null;
}
