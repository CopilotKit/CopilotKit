import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser } from "./db";
import { DomainError } from "./domain";
import type { SessionUser } from "./db";

export const SESSION_COOKIE = "northstar_session";

export function tokenFromRequest(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}

export function userFromRequest(request: Request): SessionUser | null {
  return sessionUser(tokenFromRequest(request));
}

export async function currentUser(): Promise<SessionUser | null> {
  return sessionUser((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export function assertSameOrigin(request: Request): void {
  if (
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "OPTIONS"
  )
    return;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host)
    throw new DomainError("Cross-origin mutation refused", 403);
}
