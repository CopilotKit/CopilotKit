import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  FixedWindowLimiter,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  createSessionValue,
  getClientKey,
  getRuntimeSecurityConfiguration,
  verifyAccessCode,
} from "../../../lib/runtimeSecurity";

const loginLimiter = new FixedWindowLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1_000,
  maxKeys: 1_000,
});

export async function POST(request: NextRequest) {
  const configuration = getRuntimeSecurityConfiguration();
  if (configuration.mode === "misconfigured") {
    return NextResponse.json(
      { error: "CloudPlot access control is not configured." },
      { status: 503 },
    );
  }
  if (configuration.mode === "bypass") {
    return NextResponse.json({ ok: true });
  }

  const limit = loginLimiter.consume(
    getClientKey(request.headers, Boolean(process.env.RAILWAY_ENVIRONMENT_ID)),
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many access attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let accessCode: unknown;
  try {
    ({ accessCode } = (await request.json()) as { accessCode?: unknown });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (
    typeof accessCode !== "string" ||
    !verifyAccessCode(accessCode, configuration)
  ) {
    return NextResponse.json(
      { error: "Invalid access code." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, createSessionValue(configuration), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1_000,
  });
  return response;
}
