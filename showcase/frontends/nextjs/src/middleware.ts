import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDemo, getIntegration, parseDemoPath } from "@/lib/registry";

/**
 * Guards /demos/<integration>/<demo>.
 *
 * - Answers 404 when no manifest has the integration, or when the
 *   integration's manifest does not list the demo.
 * - Otherwise passes the request on with its path in the `x-pathname`
 *   header. The demos layout reads it to name the page.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { integration, demo } = parseDemoPath(pathname);
  const isUnknownIntegration =
    integration !== undefined && getIntegration(integration) === undefined;
  const isUnlistedDemo =
    integration !== undefined &&
    demo !== undefined &&
    getDemo(integration, demo) === undefined;

  if (isUnknownIntegration || isUnlistedDemo) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/demos/:path*"],
};
