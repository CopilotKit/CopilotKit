/**
 * Runtime route for the `/auth` demo.
 *
 * Why this cannot be the generic route: the demo's whole point is a gate
 * expressed as CODE — the V2 runtime's `onRequest` hook, which runs before
 * routing and short-circuits by THROWING a Response. A thrown Response is a
 * control-flow construct; no manifest field can carry it.
 *
 * Everything else — which backend, which agent name, which runtime options —
 * still comes from the manifest, through the same resolver the generic route
 * uses. So the gate is the only per-integration difference here, and there
 * is exactly one copy of it instead of twenty.
 *
 * Next.js prefers this static `auth` segment over the sibling `[demo]`
 * segment automatically, so `/api/<integration>/auth/...` lands here. That
 * preference is no longer the only thing keeping the gate on: the generic
 * route refuses `demo === "auth"`, and the handler cache is keyed by
 * `routeId`, so nothing else can write a gate-less handler into this slot.
 *
 * Ported from showcase/integrations/*\/src/app/api/copilotkit-auth/[[...slug]]/route.ts.
 */

import { DEMO_AUTH_HEADER } from "@/lib/demo-auth-token";
import { handleDemoRequest } from "@/lib/demo-runtime";
import type { RuntimeHooks } from "@/lib/demo-runtime";

export const dynamic = "force-dynamic";

const DEMO_ID = "auth";

/**
 * The gate. A MODULE-LEVEL constant, for two reasons:
 *
 *  - `handleDemoRequest` memoises the handler these hooks are baked into and
 *    keys it on their object identity, so a fresh object per request would
 *    build a fresh handler per request (and refire per-handler telemetry).
 *  - It captures nothing: `request` arrives as the hook's own argument, so
 *    there is nothing request-specific to hold onto.
 */
const AUTH_HOOKS: RuntimeHooks = {
  onRequest: ({ request }) => {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== DEMO_AUTH_HEADER) {
      // Throwing a Response short-circuits the pipeline; the runtime
      // maps it to the HTTP response verbatim (status + body).
      throw new Response(
        JSON.stringify({
          error: "unauthorized",
          message:
            "Missing or invalid Authorization header. Click Authenticate above to send messages.",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }
  },
};

type RouteParams = { integration: string; slug?: string[] };

async function serve(
  req: Request,
  ctx: { params: Promise<RouteParams> },
): Promise<Response> {
  const { integration } = await ctx.params;
  return handleDemoRequest(req, {
    // Not decoration: `basePath` alone does not identify this route, so
    // without a distinct `routeId` the generic `[demo]` route could write its
    // GATE-LESS handler into the slot this one reads.
    routeId: "auth",
    slug: integration,
    demoId: DEMO_ID,
    basePath: `/api/${integration}/${DEMO_ID}`,
    // MULTI-ROUTE, and it must stay that way: `demos/auth/page.tsx` sets
    // `useSingleEndpoint={false}`, which is this demo's whole point — the page
    // shows the bearer header travelling on the REST sub-path requests
    // (`GET /info`, `POST /agent/:id/run`). Switching this to single-route
    // moves the client onto a protocol the page did not ask for and the gate
    // demo stops demonstrating anything.
    mode: "multi-route",
    hooks: AUTH_HOOKS,
  });
}

export const GET = serve;
export const POST = serve;
export const PUT = serve;
export const DELETE = serve;
export const OPTIONS = serve;
