/**
 * Closes, in production, the pages and routes a public deploy doesn't need:
 * the unlinked demos (/minimal on gpt-5.5, the Jev pages on TYPESAFE_API_KEY,
 * /adk and its proxy to ADK_AGENT_URL) and /snapshot, a screenshot utility.
 * Each one answers 404 unless its opt-in is set to 1. In development they all stay open.
 */
import { NextResponse, type NextRequest } from "next/server";

/** The first path segment (after /api for a route) and the env var that opens it. */
const OPT_IN: Record<string, string> = {
  minimal: "ENABLE_MINIMAL",
  jev: "ENABLE_JEV",
  "jev-chat": "ENABLE_JEV",
  adk: "ENABLE_ADK",
  snapshot: "ENABLE_SNAPSHOT",
};

export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return;
  const { pathname } = request.nextUrl;
  const api = pathname.startsWith("/api/");
  const flag = OPT_IN[pathname.split("/")[api ? 2 : 1]];
  if (!flag || process.env[flag] === "1") return;
  // A page gets the site's own not-found page: no route matches the rewritten path.
  return api
    ? Response.json({ error: "Not found" }, { status: 404 })
    : NextResponse.rewrite(new URL("/_closed", request.url));
}

export const config = {
  matcher: [
    "/minimal/:path*",
    "/jev/:path*",
    "/adk/:path*",
    "/snapshot/:path*",
    "/api/minimal/:path*",
    "/api/jev/:path*",
    "/api/jev-chat/:path*",
    "/api/adk/:path*",
  ],
};
