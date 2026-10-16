import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveBackendUrl } from "@/lib/backend-url";
import { resolveLegacyDojoRedirect } from "@/lib/legacy-redirects";
import { getIntegration } from "@/lib/registry";
import { getRuntimeConfig } from "@/lib/runtime-config";

export function middleware(request: NextRequest) {
  const redirect = resolveLegacyDojoRedirect(request.nextUrl, {
    demoRoute: (slug, demo) =>
      getIntegration(slug)?.demos.find((d) => d.id === demo)?.route,
    backendUrl: (slug) =>
      resolveBackendUrl(
        slug,
        getRuntimeConfig({ noStore: false }).backendHostPattern,
      ),
  });
  if (!redirect) return NextResponse.next();
  // Relative dojo locations resolve against the request; Next strips the
  // origin back off for same-origin redirects.
  return NextResponse.redirect(
    new URL(redirect.location, request.nextUrl),
    redirect.permanent ? 308 : 307,
  );
}

export const config = {
  // Every non-root path except Next internals and static files (anything
  // with an extension). The dojo itself only serves `/`.
  matcher: ["/((?!_next/|.*\\..*).+)"],
};
