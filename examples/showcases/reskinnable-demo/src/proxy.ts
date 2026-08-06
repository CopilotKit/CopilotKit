import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { lockedSkinId } from "@/lib/locked-skin";

/**
 * The single-tenant URL space.
 *
 * Every page in this app lives under `/[skin]`. On a LOCK_SKIN deploy that
 * segment is noise — the deploy IS the product, there is nothing to
 * disambiguate — so this maps the prefix-free space the browser shows onto the
 * route tree that exists on disk: `/` → `/banking`, `/cards` → `/banking/cards`.
 *
 * A REWRITE, not a redirect: the address bar keeps the clean URL. The previous
 * behaviour redirected `/` → `/banking`, which put the substrate's tenant id in
 * front of a customer on the front door and on every link after it.
 *
 * Unlocked this returns undefined and every request routes exactly as before.
 *
 * ## Why `proxy.ts` and not a `next.config` rewrite
 *
 * `rewrites()` is serialised into `routes-manifest.json` at BUILD time, so a
 * rewrite keyed on LOCK_SKIN would bake the lock into the artifact. Proxy files
 * are always routed to the Node.js server (never Edge), so LOCK_SKIN is read
 * per REQUEST and ONE BUILD STILL SERVES BOTH a locked and an unlocked host —
 * the invariant that `src/lib/locked-skin.ts` being a non-`NEXT_PUBLIC_` env and
 * the root layout's `force-dynamic` both exist to protect.
 *
 * `proxy.ts` is Next 16's rename of `middleware.ts`; same request hook.
 *
 * ## Why the SSE stream is safe
 *
 * The matcher excludes `api` outright, so `/api/copilotkit` never enters this
 * function. The concern that originally kept LOCK_SKIN away from a request-time
 * hook is answered by construction rather than by care.
 */
export const config = {
  // Everything EXCEPT: the runtime + REST endpoints, Next's own asset routes,
  // and any path carrying a file extension (`public/`, `favicon.ico`). No
  // route-bearing id in this app contains a dot — keel's doc and run ids are
  // kebab-case — so the extension test cannot swallow a real page.
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};

export function proxy(request: NextRequest) {
  // Throws on an unrecognised id, deliberately: a typo should take the deploy
  // down loudly at the front door rather than 404 every route with nothing
  // pointing at the cause. Same contract as the root layout's call.
  const locked = lockedSkinId();
  if (!locked) return;

  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();
  // Unconditional: a request that already carries the prefix (`/banking` from a
  // stale bookmark) becomes `/banking/banking`, whose `resolvePage` lookup
  // misses and 404s. That is the intended answer — under a lock the tenant path
  // is as absent as `/nope`, matching how the other three skins behave.
  url.pathname = pathname === "/" ? `/${locked}` : `/${locked}${pathname}`;
  return NextResponse.rewrite(url);
}
