import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Copies the request pathname into an `x-pathname` request header.
 *
 * Byte-identical to the middleware that the FOUR showcase integrations
 * shipping one carry (`showcase/integrations/<slug>/src/middleware.ts` exists
 * for langgraph-fastapi, langgraph-python, langgraph-typescript and
 * ms-agent-dotnet only; the other 16 have no middleware at all) — same header
 * name, same matcher — so the unified frontend behaves like the
 * per-integration apps it replaces.
 *
 * WHY THIS APP NEEDS IT. `src/app/[integration]/demos/layout.tsx` is the
 * ONE place that runs for every demo route, static segment or dynamic
 * placeholder alike, so it is where the support guard has to live. But a
 * layout at that path only receives the `[integration]` param — the demo id
 * is a CHILD segment and Next.js never passes it up. The header is how the
 * layout learns the full path. Remove this file and every demo URL renders
 * the "Invalid Showcase route" state, loudly and immediately, rather than
 * silently skipping the guard.
 */

/**
 * The request header that carries the pathname to the demos layout.
 *
 * Exported so `src/app/[integration]/demos/layout.tsx` imports the SAME
 * constant it is set with. The two used to agree by convention only, which
 * meant a rename here would break the guard with nothing to catch it.
 */
export const PATHNAME_HEADER = "x-pathname";

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  // `.set` (not `.append`): this OVERWRITES any client-supplied
  // `x-pathname`, so a spoofed header can never reach the layout guard on a
  // path the matcher covers. The matcher below covers EVERY `/<slug>/demos`
  // path, which is every path the layout guard runs for — see the note there
  // for the bypass that existed while it did not.
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

/**
 * THE `/<slug>/demos` ARM IS THE GUARD, not a convenience.
 *
 * The static-asset exclusion used to be a bare `.*\..*` — skip any path
 * containing a dot. On a skipped path this middleware does not run, so
 * `x-pathname` reaches `demos/layout.tsx` exactly as the CLIENT wrote it, and
 * `classifyDemoPathname` cross-checks only SEGMENT 0 of that header against
 * the layout's `[integration]` param. So:
 *
 *     GET /mastra/demos/gen-ui-interrupt.x
 *     x-pathname: /mastra/demos/agentic-chat
 *
 * agreed on `mastra`, passed the guard, and the layout resolved the SUPPORTED
 * `agentic-chat` and rendered `children` for a request whose real demo id was
 * `gen-ui-interrupt.x`. Only `[demo]/page.tsx` — which reads the real id from
 * `params` — stopped it. Not exploitable in the end (no demo folder id holds a
 * dot, so the spoof could only ever name an id nothing serves), but the layout
 * guard was skippable through a header, and it is the node that wraps all 43
 * STATIC demo segments.
 *
 * `/<seg>/demos` and `/<seg>/demos/**` are ROUTES, never static assets, so
 * they are matched unconditionally and the dot rule applies only to everything
 * else. `layout.test.tsx` pins the whole chain end to end.
 *
 * WHAT THIS BROADENS, measured by compiling both matchers through Next's own
 * `getMiddlewareMatchers`: exactly the dotted `/<seg>/demos/**` paths, and
 * nothing else. `/_next/**`, `/favicon.ico`, `/robots.txt`,
 * `/copilotkit-logo.svg`, `/demo-files/sample.pdf` and `/demo-audio/sample.wav`
 * — every file under `public/` — are skipped exactly as before, and no asset
 * lives under a `/<seg>/demos/` prefix. Middleware on a matched request only
 * sets one request header and returns `NextResponse.next()`.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico)(?:[^/]+/demos(?:/.*)?|(?!.*\\..*).*))",
  ],
};
