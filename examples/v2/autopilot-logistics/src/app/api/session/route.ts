import { NextResponse } from "next/server";
import { assertSameOrigin, SESSION_COOKIE, tokenFromRequest } from "@/lib/auth";
import { createSession, deleteSession } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const data = await request.formData();
    const account = String(data.get("account") ?? "");
    const token = createSession(account);
    const destination = new URL("/", request.url);
    destination.host = request.headers.get("host") ?? destination.host;
    const response = NextResponse.redirect(destination, 303);
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sign-in failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const token = tokenFromRequest(request);
    if (token) deleteSession(token);
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch {
    return NextResponse.json({ error: "Sign-out failed" }, { status: 400 });
  }
}
