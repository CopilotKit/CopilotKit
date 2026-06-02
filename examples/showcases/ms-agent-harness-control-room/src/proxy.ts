import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const AUTH_REALM = 'Basic realm="Control Room", charset="UTF-8"';

export function proxy(req: NextRequest) {
  const credentials = process.env.CONTROL_ROOM_BASIC_AUTH;
  if (!credentials || req.nextUrl.pathname === "/api/healthz") {
    return NextResponse.next();
  }

  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      if (atob(authorization.slice("Basic ".length)) === credentials) {
        return NextResponse.next();
      }
    } catch {
      // Fall through to the challenge response.
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": AUTH_REALM,
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
