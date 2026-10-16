import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveLegacyDojoPath } from "@/lib/legacy-redirects";

export function middleware(request: NextRequest) {
  const destination = resolveLegacyDojoPath(request.nextUrl.pathname);
  if (!destination) return NextResponse.next();
  const url = request.nextUrl.clone();
  const [pathname, search = ""] = destination.split("?");
  url.pathname = pathname;
  url.search = search;
  return NextResponse.redirect(url, 308);
}

export const config = {
  // Every non-root path except Next internals and static files (anything
  // with an extension). The dojo itself only serves `/`.
  matcher: ["/((?!_next/|.*\\..*).+)"],
};
