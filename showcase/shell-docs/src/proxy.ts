import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { isMarkdownPreferred } from "fumadocs-core/negotiation";
import { legacyRedirect } from "@/lib/redirects/legacy-redirect";
import { trackRequest } from "@/lib/telemetry/proxy";
import { basePath, withBasePath } from "@/lib/base-path";
import { DOCS_VERSIONS } from "@/lib/docs-versions.mjs";

/** Where a live page's Markdown is served (`src/app/llms.mdx/live`). */
const LIVE_MARKDOWN_ROUTE = "/llms.mdx/live";

/**
 * Paths that are never a live docs page, so they're never rewritten to its
 * Markdown: v2's own routes, Next internals, the folders in `public/`, and
 * files (`robots.txt` is often fetched with `Accept: text/plain`, which
 * Fumadocs reads as preferring Markdown).
 */
const NOT_LIVE_DOCS =
  /^\/(?:(?:docs|proto|api|og|_next|ingest|images|logos|videos|ideas|\.well-known)(?:\/|$)|llms|__nextjs)|\.(?:txt|xml|json|webmanifest|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|map|js|css|mp4|webm|pdf)$/;

/** `/frontend-tools.md` or `.mdx` to `/frontend-tools`, else null. */
function liveMarkdownPath(pathname: string): string | null {
  const match = pathname.match(/^(\/.+?)\.mdx?$/);
  if (!match || NOT_LIVE_DOCS.test(pathname)) return null;
  return match[1];
}

/**
 * On the stable docs, the other versions (`/v2`) and the variable that names
 * each one's deployment (its private Railway URL).
 */
const OTHER_VERSIONS = basePath
  ? []
  : DOCS_VERSIONS.filter((version) => version.path && version.originEnv);

/**
 * A request for another version's path, forwarded to that version's
 * deployment, or null. Read at request time, not build time: CI builds the
 * stable docs' image, so a Railway variable never reaches its `next build`.
 * Without the variable the path falls through to this build (a 404).
 */
function otherVersionRewrite(request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  for (const version of OTHER_VERSIONS) {
    if (pathname !== version.path && !pathname.startsWith(`${version.path}/`)) {
      continue;
    }
    // A computed key, so Next doesn't inline it at build time.
    const origin = process.env[version.originEnv as string]
      ?.trim()
      .replace(/\/+$/, "");
    if (!origin) return null;
    return NextResponse.rewrite(new URL(`${origin}${pathname}${search}`));
  }
  return null;
}

/** The PostHog reverse proxy's paths (the /ingest rewrites in next.config.mjs). */
const POSTHOG_PROXY = /^\/ingest(?:\/|$)/;

/**
 * Let the request through without the headers Cloudflare adds in front of
 * this site (`cf-connecting-ip`, `cf-ray`, `cdn-loop` and so on). The /ingest
 * rewrites forward every request header to PostHog, whose hosts are on
 * Cloudflare too, and its asset host answers a request carrying
 * `cf-connecting-ip` with 403 (error 1000). The visitor's IP still reaches
 * PostHog in `x-forwarded-for`.
 */
function withoutCloudflareHeaders(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  for (const name of request.headers.keys()) {
    if (name.startsWith("cf-") || name === "cdn-loop") headers.delete(name);
  }
  return NextResponse.next({ request: { headers } });
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  if (POSTHOG_PROXY.test(pathname)) return withoutCloudflareHeaders(request);

  const otherVersion = otherVersionRewrite(request);
  if (otherVersion) return otherVersion;

  // Prototype D became the site: its old /proto/d URLs open at the root.
  const proto = /^\/proto\/d(?=\/|$)/;
  if (proto.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = url.pathname.replace(proto, "") || "/";
    return NextResponse.redirect(url);
  }

  // Legacy docs.copilotkit.ai URLs (shell-docs' middleware redirects). Before
  // the Markdown rewrites, so a retired page's `.md` URL redirects too.
  const legacy = legacyRedirect(request);
  if (legacy) return legacy;

  // `<path>.md` / `.mdx`: the page as Markdown. Telemetry reads the surface
  // from the suffix.
  const liveMarkdown = liveMarkdownPath(pathname);
  if (liveMarkdown) {
    return trackRequest(
      request,
      event,
      NextResponse.rewrite(
        new URL(
          withBasePath(`${LIVE_MARKDOWN_ROUTE}${liveMarkdown}`),
          request.nextUrl,
        ),
      ),
    );
  }

  // `Accept: text/markdown` on a page URL: the same Markdown, at the page's
  // own URL.
  if (isMarkdownPreferred(request)) {
    const target =
      pathname !== "/" && !NOT_LIVE_DOCS.test(pathname)
        ? `${LIVE_MARKDOWN_ROUTE}${pathname.replace(/\/+$/, "")}`
        : null;
    if (target) {
      return trackRequest(
        request,
        event,
        NextResponse.rewrite(new URL(withBasePath(target), request.nextUrl), {
          // this URL has two representations, selected by `Accept`
          headers: { Vary: "Accept" },
        }),
        { surface: "page_markdown" },
      );
    }
  }

  return trackRequest(request, event, NextResponse.next());
}
