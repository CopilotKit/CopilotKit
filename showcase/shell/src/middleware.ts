import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { seoRedirects } from "@/lib/seo-redirects";
import type { RedirectEntry } from "@/lib/seo-redirects";
import { getRuntimeConfigForMiddleware } from "@/lib/runtime-config";
import {
  resolveDocsHostRedirect,
  resolveSeoDestination,
} from "@/lib/docs-redirects";
import registry from "@/data/registry.json";

// ---------------------------------------------------------------------------
// Build lookup structures at module load (once per cold start)
// ---------------------------------------------------------------------------

/**
 * Build the exact-match map and wildcard list from the redirect table
 * (exported for tests). The table is documented as "first match wins" —
 * a plain Map.set loop silently inverted that to LAST-write-wins for
 * the duplicate exact sources (e.g. P2×unselected overrode
 * SR-root×unselected), skewing PostHog redirect_id attribution. Skip
 * later duplicates and warn once at module load, naming them.
 */
export function buildRedirectLookup(entries: readonly RedirectEntry[]): {
  /** Exact-match map: source path -> { id, destination } */
  exactMap: Map<string, { id: string; destination: string }>;
  /** Wildcard entries: source has :path* -- stored as { prefix, id, destination } */
  wildcardEntries: { prefix: string; id: string; destinationTemplate: string }[];
} {
  const exactMap = new Map<string, { id: string; destination: string }>();
  const wildcardEntries: {
    prefix: string;
    id: string;
    destinationTemplate: string;
  }[] = [];
  const duplicateSources: string[] = [];
  const malformedWildcards: string[] = [];

  for (const entry of entries) {
    const wildcardIdx = entry.source.indexOf(":path*");
    if (wildcardIdx === -1) {
      const existing = exactMap.get(entry.source);
      if (existing) {
        duplicateSources.push(
          `${entry.source} (${entry.id} shadowed by ${existing.id})`,
        );
        continue;
      }
      exactMap.set(entry.source, {
        id: entry.id,
        destination: entry.destination,
      });
    } else {
      const prefix = entry.source.slice(0, wildcardIdx);
      // A wildcard prefix MUST end with "/" — the matcher's
      // `startsWith(prefix)` would otherwise match prefix LOOKALIKES
      // (e.g. a source "/x:path*" matching "/xylophone"). Treat a
      // violation as a table bug: warn loudly and skip the entry.
      if (!prefix.endsWith("/")) {
        malformedWildcards.push(`${entry.source} (${entry.id})`);
        continue;
      }
      wildcardEntries.push({
        prefix,
        id: entry.id,
        destinationTemplate: entry.destination,
      });
    }
  }

  if (duplicateSources.length > 0) {
    console.warn(
      "[middleware] seo-redirects has duplicate exact sources — first " +
        `match wins, later entries are ignored: ${duplicateSources.join(", ")}`,
    );
  }
  if (malformedWildcards.length > 0) {
    console.warn(
      "[middleware] seo-redirects has wildcard sources whose prefix does " +
        'not end with "/" — they would match prefix lookalikes and are ' +
        `ignored: ${malformedWildcards.join(", ")}`,
    );
  }

  return { exactMap, wildcardEntries };
}

const { exactMap, wildcardEntries } = buildRedirectLookup(seoRedirects);

// ---------------------------------------------------------------------------
// PostHog tracking via fetch (Edge Runtime compatible — no posthog-node SDK)
// ---------------------------------------------------------------------------

let posthogKeyWarned = false;

// One loud log per distinct capture-failure class (`http:<status>` /
// `net:<error name>`), not per request — mirrors the patternWarnings
// pattern in lib/backend-url.ts. Observability here is load-bearing:
// the redirect-decommission report deletes redirects that show ZERO
// PostHog traffic, so silently-broken capture (a swallowed rejection or
// an unchecked 4xx/5xx) leads to wrongful deletions.
const captureFailureWarnings = new Set<string>();

function warnCaptureFailureOnce(failureClass: string, detail: string): void {
  if (captureFailureWarnings.has(failureClass)) return;
  captureFailureWarnings.add(failureClass);
  console.warn(
    `[middleware] PostHog redirect capture failing (${failureClass}): ` +
      `${detail} — seo_redirect events are not being recorded, so the ` +
      "redirect decommission report will under-count this traffic.",
  );
}

/**
 * Defensive use-site normalization: POSTHOG_HOST can be set scheme-less
 * (the sibling SHOWCASE_BACKEND_HOST_PATTERN var is documented as
 * host-only, an easy format to carry over), and a scheme-less host makes
 * the capture `fetch()` reject a relative URL on EVERY redirect. Proper
 * normalization belongs in runtime-config (readDocsHost already does
 * this for DOCS_HOST) — that is a sibling fix; this guard keeps the
 * middleware safe regardless.
 */
function normalizePosthogHost(host: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `https://${host}`;
}

function trackRedirect(
  event: NextFetchEvent,
  // posthogHost/posthogKey are resolved ONCE per request in middleware()
  // and passed in — trackRedirect used to call
  // getRuntimeConfigForMiddleware() again, resolving the config twice
  // per redirected request.
  posthogHost: string,
  posthogKey: string | undefined,
  id: string,
  fromPath: string,
  dest: URL,
): void {
  if (!posthogKey) {
    if (!posthogKeyWarned) {
      console.warn(
        "[middleware] POSTHOG_KEY is not set — redirect tracking disabled",
      );
      posthogKeyWarned = true;
    }
    return;
  }

  const captureUrl = `${normalizePosthogHost(posthogHost)}/capture/`;

  // Don't await (never block the redirect), but DO hand the promise to
  // event.waitUntil — the Edge runtime may otherwise terminate as soon
  // as the redirect response is returned, dropping the in-flight capture.
  const capture = fetch(captureUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: posthogKey,
      event: "seo_redirect",
      distinct_id: "seo-redirect-tracker",
      properties: {
        redirect_id: id,
        from_path: fromPath,
        // to_path alone is ambiguous for self-referential entries (e.g.
        // M3 /faq -> docs-host /faq emits from_path === to_path) — the
        // decommission report needs the destination HOST to tell them
        // apart. to_path is kept for continuity with historic events;
        // to_url adds the host but excludes the query string (it varies
        // per request and would explode property cardinality).
        to_path: dest.pathname,
        to_url: `${dest.origin}${dest.pathname}`,
      },
    }),
  })
    .then((res) => {
      // A 4xx/5xx resolves the fetch promise — without this check a
      // misconfigured key/host fails capture silently forever.
      if (!res.ok) {
        warnCaptureFailureOnce(
          `http:${res.status}`,
          `POST ${captureUrl} returned ${res.status}`,
        );
      }
    })
    .catch((err: unknown) => {
      // Never block or fail the redirect on tracking errors — but DO
      // surface them (once per class) instead of swallowing.
      const name = err instanceof Error ? err.name : typeof err;
      const message = err instanceof Error ? err.message : String(err);
      warnCaptureFailureOnce(`net:${name}`, message);
    });
  event.waitUntil(capture);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Framework slugs owned by the docs shell. Any path whose first
// segment matches one of these is a framework-scoped docs URL — it
// 308s to the docs host BEFORE the SEO-redirect table runs, so legacy
// redirects (e.g. S1×mastra: `/mastra/agentic-chat-ui` →
// `/mastra/prebuilt-components`) can never hijack it even when legacy
// framework keys overlap with registry slugs.
export const REGISTRY_FRAMEWORK_SLUGS: Set<string> = new Set(
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
  // Resolve the Edge-safe runtime config (live process.env at request
  // time, no `next/cache` import) ONCE per request and thread the
  // values through — see getRuntimeConfigForMiddleware in
  // src/lib/runtime-config.ts.
  const { docsHost, posthogHost } = getRuntimeConfigForMiddleware();
  const posthogKey = process.env.POSTHOG_KEY;

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
    trackRedirect(event, posthogHost, posthogKey, exact.id, pathname, dest);
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
        // Function replacer: `rest` is user-controlled, and the string
        // form of String.prototype.replace expands `$&`, "$`", `$'`,
        // `$$` in the replacement (e.g. /coagents/$&foo would leak the
        // literal ":path*" token into the Location header).
        destination = wc.destinationTemplate.replace(":path*", () => rest);
      } else {
        destination = wc.destinationTemplate;
      }
      const dest = resolveSeoDestination(destination, docsHost);
      dest.search = request.nextUrl.search;
      trackRedirect(event, posthogHost, posthogKey, wc.id, pathname, dest);
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
