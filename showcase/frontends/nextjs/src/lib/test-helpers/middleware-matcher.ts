import { NextRequest } from "next/server";

import { config, middleware, PATHNAME_HEADER } from "@/middleware";

/**
 * Answers, for one pathname, the two questions the support guard depends on:
 * does `src/middleware.ts` run for it, and what does
 * `src/app/[integration]/demos/layout.tsx` therefore end up reading out of
 * `x-pathname`?
 *
 * Shared by `src/middleware.test.ts` and the demos `layout.test.tsx` so both
 * ask the SAME question of the SAME matcher string. They used to each build
 * their own regex, which is how a matcher gap could be pinned as "known" in one
 * file while the other assumed it away.
 *
 * FIDELITY. `new RegExp("^" + source + "$")` is not byte-identical to what
 * `next build` compiles. Next's `getMiddlewareMatchers` wraps the same source
 * in an optional `/_next/data/<build-id>` prefix and an optional
 * `.json`/`.rsc`/`.segments/*.segment.rsc` suffix. Verified against Next's own
 * compiler for every path these tests use: the wrapper changes none of them,
 * because none is a data or RSC transport URL. If you add a case that IS one,
 * compile it through `getMiddlewareMatchers` instead of trusting this.
 */
export function middlewareRuns(pathname: string): boolean {
  return new RegExp(`^${config.matcher[0]}$`).test(pathname);
}

/**
 * The `x-pathname` value the demos layout actually receives for a request.
 *
 * This is the whole guard chain in one function. When the matcher covers the
 * path the middleware runs and OVERWRITES whatever the client sent; when the
 * matcher skips it, the client's header is passed through untouched. Rendering
 * the layout with a hand-written header tests the layout; rendering it with
 * THIS tests the app.
 */
export function effectivePathnameHeader(
  url: string,
  clientSupplied: string | null = null,
): string | null {
  const request = new NextRequest(
    url,
    clientSupplied === null
      ? undefined
      : { headers: { [PATHNAME_HEADER]: clientSupplied } },
  );

  if (!middlewareRuns(request.nextUrl.pathname)) return clientSupplied;

  return middleware(request).headers.get(
    `x-middleware-request-${PATHNAME_HEADER}`,
  );
}
