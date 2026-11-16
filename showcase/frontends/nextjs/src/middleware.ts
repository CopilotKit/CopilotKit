import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIntegration, hasDemo, parseDemoPath } from "@/lib/registry";

/**
 * Guards /demos/<integration>/<demo>.
 *
 * - Answers 404 when no manifest has the integration, or when the
 *   integration does not serve the demo (it is neither in its manifest nor
 *   in its extra demos).
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
    !hasDemo(integration, demo);

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
