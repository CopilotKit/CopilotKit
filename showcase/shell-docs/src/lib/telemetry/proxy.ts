// Server-side PostHog events sent from `src/proxy.ts`, ported from shell-docs'
// middleware: `docs_pageview` (every page request, with a first-party
// `ph_distinct_id` cookie), `docs.llm_text_fetched` (llms.txt, llms-full.txt,
// and raw markdown, which never run the client snippet), and `seo_redirect`.
// Same event names, properties, distinct ids, and env vars (`POSTHOG_KEY`,
// `NEXT_PUBLIC_POSTHOG_HOST`) as shell-docs.

import type { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { getPosthogHost } from "./config";
import { classifyLlmTextCaller } from "./llm-text-callers";

export type LlmTextSurface =
  /** `/llms.txt`, the llmstxt.org index of every page. */
  | "llms_index"
  /** `/llms-full.txt`, every page in one blob. */
  | "llms_full"
  /** One page as raw Markdown (`<path>.md`, `.mdx`, or `Accept: text/markdown`). */
  | "page_markdown";

/** Name the raw-text surface a path is for, or null for an ordinary page. */
export function resolveLlmTextSurface(pathname: string): LlmTextSurface | null {
  if (pathname === "/llms.txt") return "llms_index";
  if (pathname === "/llms-full.txt") return "llms_full";
  if (pathname.endsWith(".md") || pathname.endsWith(".mdx")) {
    return "page_markdown";
  }
  return null;
}

const DISTINCT_ID_COOKIE = "ph_distinct_id";
// ~2 years, long enough to count returning visitors.
const DISTINCT_ID_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2;
// The user agent is caller-controlled; cap what goes into the event stream.
const MAX_USER_AGENT_LENGTH = 512;

// shell-docs' middleware matcher, as a test: Next internals, APIs, the
// PostHog proxy, and static assets are not page views. (v2's proxy has no
// matcher, so it sees all of these.)
const UNTRACKED_PATH =
  /^\/(?:api\/|ingest\/|_next\/|__nextjs|favicon\.ico|previews\/|robots\.txt|sitemap\.xml|manifest\.webmanifest|\.well-known\/)/;
const ASSET_PATH =
  /\.(?:png|jpg|jpeg|svg|gif|webp|ico|avif|woff2?|ttf|otf|eot|map)$/;

let warnedMissingKey = false;
function posthogKey(): string | undefined {
  const key = process.env.POSTHOG_KEY;
  if (!key && !warnedMissingKey) {
    warnedMissingKey = true;
    console.warn("[proxy] POSTHOG_KEY is not set — analytics disabled");
  }
  return key || undefined;
}

/**
 * Report a request from `src/proxy.ts`, once its response is decided.
 *
 * Counts real GET reads only (no prefetches) as either a raw-text fetch or a
 * page view, never both. Pass `surface` when the proxy has already decided the
 * request is raw markdown (content negotiation on `Accept`). Returns the
 * response, with the distinct-id cookie set for first-time visitors.
 */
export function trackRequest(
  request: NextRequest,
  event: NextFetchEvent,
  response: NextResponse,
  options: { surface?: LlmTextSurface } = {},
): NextResponse {
  const { pathname } = request.nextUrl;
  if (UNTRACKED_PATH.test(pathname) || ASSET_PATH.test(pathname)) {
    return response;
  }
  // HEAD is excluded on purpose: agents often probe with HEAD before a GET.
  if (request.method !== "GET") return response;
  if (
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose") === "prefetch"
  ) {
    return response;
  }

  if (!posthogKey()) return response;

  const surface = options.surface ?? resolveLlmTextSurface(pathname);
  if (surface) {
    event.waitUntil(captureLlmTextFetch(request, pathname, surface));
    return response;
  }

  const existingDistinctId = request.cookies.get(DISTINCT_ID_COOKIE)?.value;
  const distinctId = existingDistinctId ?? crypto.randomUUID();
  if (!existingDistinctId) {
    response.cookies.set({
      name: DISTINCT_ID_COOKIE,
      value: distinctId,
      maxAge: DISTINCT_ID_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      // `secure` would stop the cookie setting over local http.
      secure: process.env.NODE_ENV === "production",
      httpOnly: false,
    });
  }
  event.waitUntil(capturePageView(pathname, distinctId));
  return response;
}

/** `seo_redirect`, for a redirect the proxy issues. Fire-and-forget. */
export function trackRedirect(id: string, fromPath: string, toPath: string) {
  if (!posthogKey()) return;
  posthog
    .capture(
      "seo_redirect",
      { redirect_id: id, from_path: fromPath, to_path: toPath },
      "seo-redirect-tracker",
    )
    .catch(() => {
      // Never block a redirect on analytics.
    });
}

// Shaped `posthog.capture("literal", { inline props }, id)` so each event
// stays visible to the telemetry catalog extractor
// (scripts/telemetry/extract.ts).
const posthog = {
  async capture(
    event: string,
    properties: Record<string, unknown>,
    distinctId: string,
  ): Promise<void> {
    const response = await fetch(`${getPosthogHost()}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.POSTHOG_KEY,
        event,
        distinct_id: distinctId,
        properties,
      }),
    });
    if (!response.ok) {
      throw new Error(`posthog capture responded ${response.status}`);
    }
  },
};

async function capturePageView(
  pathname: string,
  distinctId: string,
): Promise<void> {
  try {
    await posthog.capture("docs_pageview", { path: pathname }, distinctId);
  } catch (err) {
    console.warn("[proxy] posthog capture failed", err);
  }
}

async function captureLlmTextFetch(
  request: NextRequest,
  pathname: string,
  surface: LlmTextSurface,
): Promise<void> {
  const userAgent = request.headers.get("user-agent");
  const caller = classifyLlmTextCaller(userAgent);
  // These callers never return a cookie, so the id is derived instead.
  const distinctId = await callerKey(clientIp(request), userAgent);
  try {
    await posthog.capture(
      "docs.llm_text_fetched",
      {
        path: pathname,
        surface,
        caller_class: caller.class,
        caller_agent: caller.agent,
        // The raw UA travels so a wrong bucket can be re-cut over history.
        $raw_user_agent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
        environment: deploymentEnvironment(),
        referrer: request.headers.get("referer"),
        // No person per crawler, and no geo from the server's own IP.
        $geoip_disable: true,
        $process_person_profile: false,
      },
      distinctId,
    );
  } catch (err) {
    console.warn("[proxy] posthog llm-text capture failed", err);
  }
}

function clientIp(request: NextRequest): string | null {
  // The left-most `x-forwarded-for` entry is the original client.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

/** A stable, non-reversible handle for "the same caller": hashed IP + UA. */
async function callerKey(
  ip: string | null,
  userAgent: string | null,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip ?? "no-ip"}|${userAgent ?? "no-ua"}`),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `llm-text:${hex.slice(0, 16)}`;
}

/** Which deployment served the fetch, so previews and dev stay separable. */
function deploymentEnvironment(): string {
  return (
    process.env.RAILWAY_ENVIRONMENT_NAME ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    "development"
  );
}
