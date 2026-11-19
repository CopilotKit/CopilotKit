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
 * On the stable docs, the other versions' paths (`/v2/...`). next.config.mjs
 * forwards them to those versions' deployments, which run their own proxy.
 */
const OTHER_VERSION_PATH = basePath
  ? null
  : new RegExp(
      `^(?:${DOCS_VERSIONS.filter((version) => version.path)
        .map((version) => version.path)
        .join("|")})(?:/|$)`,
    );

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  if (OTHER_VERSION_PATH?.test(pathname)) return NextResponse.next();

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
