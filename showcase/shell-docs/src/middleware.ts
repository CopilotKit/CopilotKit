import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Minimal middleware for shell-docs.
//
// shell-docs serves docs.showcase.copilotkit.ai — a NEW hostname that
// never hosted legacy URLs, so it has no SEO-redirect table of its own.
// The legacy → docs host migration is handled by the SHELL's
// next.config.ts redirects(), which 301s /docs, /ag-ui, /reference, and
// /<framework>/... from the old host onto this one.
//
// This middleware mirrors the shell's PostHog tracking scaffolding (as
// a fire-and-forget Edge fetch) so we have a single spot to attach
// docs-host analytics without pulling in posthog-node.
// ---------------------------------------------------------------------------

const POSTHOG_HOST = "https://eu.i.posthog.com";

let posthogKeyWarned = false;

function trackPageView(pathname: string): void {
  const apiKey = process.env.POSTHOG_PROJECT_KEY;
  if (!apiKey) {
    if (!posthogKeyWarned) {
      console.warn(
        "[middleware] POSTHOG_PROJECT_KEY is not set — analytics disabled",
      );
      posthogKeyWarned = true;
    }
    return;
  }

  fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event: "docs_pageview",
      distinct_id: "docs-pageview-tracker",
      properties: {
        path: pathname,
      },
    }),
  }).catch(() => {
    // Silently ignore tracking failures — don't block navigation
  });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  trackPageView(pathname);
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip static assets and Next.js internals.
    "/((?!api|_next/static|_next/image|favicon\\.ico|previews/).*)",
  ],
};
