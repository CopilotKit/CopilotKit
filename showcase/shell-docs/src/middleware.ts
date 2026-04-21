import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Minimal middleware for shell-docs.
//
// shell-docs serves docs.showcase.copilotkit.ai — a NEW hostname that
// never hosted legacy URLs, so it has no SEO-redirect table of its own.
// The legacy → docs host migration is handled by the SHELL's
// next.config.ts redirects(), which 301s /docs, /ag-ui, /reference, and
// /<framework>/... from the old host onto this one.
//
// This middleware mirrors the shell's PostHog tracking scaffolding so we
// have a single spot to attach docs-host analytics without pulling in
// posthog-node.
//
// Each visitor gets a stable distinct_id via a first-party cookie
// (`ph_distinct_id`); a new UUID is minted on first visit and attached
// via Set-Cookie on the response. The PostHog capture fetch is kept
// alive past response return via NextFetchEvent.waitUntil() —
// fire-and-forget in Edge runtime is not guaranteed to complete once
// NextResponse.next() returns.
// ---------------------------------------------------------------------------

const POSTHOG_HOST = "https://eu.i.posthog.com";
const DISTINCT_ID_COOKIE = "ph_distinct_id";
// ~2 years — long enough to meaningfully track returning visitors.
const DISTINCT_ID_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2;

// Warn once per isolate at module load if the key is missing. Edge runtime
// module globals are per-isolate and short-lived, so a request-scoped
// warn-once flag is unreliable; module-load is the cleanest available hook.
const POSTHOG_PROJECT_KEY = process.env.POSTHOG_PROJECT_KEY;
if (!POSTHOG_PROJECT_KEY && typeof process !== "undefined") {
  console.warn(
    "[middleware] POSTHOG_PROJECT_KEY is not set — analytics disabled",
  );
}

function capturePageView(
  pathname: string,
  distinctId: string,
): Promise<unknown> {
  if (!POSTHOG_PROJECT_KEY) {
    return Promise.resolve();
  }

  return fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: POSTHOG_PROJECT_KEY,
      event: "docs_pageview",
      distinct_id: distinctId,
      properties: {
        path: pathname,
      },
    }),
  }).catch((err) => {
    // Surface capture failures (401/403/5xx, DNS, etc.) so operators can
    // diagnose — swallowing errors silently hides real outages.
    console.warn("[middleware] posthog capture failed", err);
  });
}

export function middleware(
  request: NextRequest,
  event: NextFetchEvent,
): NextResponse {
  // Skip non-GET (HEAD, POST, etc.) and Next.js router prefetches —
  // these are not real pageviews and would pollute analytics. Next.js
  // prefetches links via low-priority fetches that still hit middleware,
  // so we filter on both the \`next-router-prefetch\` header (App Router)
  // and the generic \`purpose: prefetch\` header.
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

  const { pathname } = request.nextUrl;

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
      secure: true,
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
    "/((?!api/|_next/static|_next/image|favicon\\.ico|previews/|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|\\.well-known/)(?!.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|avif|woff2?|ttf|otf|eot|map)(?:\\?.*)?$).*)",
  ],
};
