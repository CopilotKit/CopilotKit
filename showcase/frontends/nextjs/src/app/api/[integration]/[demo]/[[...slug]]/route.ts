/**
 * THE generic CopilotKit runtime route for the unified showcase app.
 *
 * `/api/<integration>/<demo>/...` serves every (integration, demo) pair
 * whose behaviour is expressible as DATA. It replaces the ~339 per-package
 * route files the 20 integrations used to carry: the differences between
 * those files were agent URL, agent name, graph id and a handful of
 * CopilotRuntime flags, and all four now live in each integration's
 * `manifest.yaml`.
 *
 * Two demos are NOT data and keep their own sibling routes:
 *   ./auth  — a bearer-header gate, which is code
 *   ./voice — a transcription-service class instance, which is code
 * Next.js prefers those static segments over this `[demo]` one automatically,
 * but this route REFUSES those two ids anyway rather than relying on that. A
 * request that reaches `[demo]` with a decoded param of `auth` would otherwise
 * serve the auth demo through this route — with no bearer gate, because the
 * gate is code that lives in the sibling file.
 *
 * The catch-all `[[...slug]]` is required: the V2 runtime handler URL-routes
 * `/info`, `/agent/:id/run`, `/agent/:id/connect`, `/transcribe` and friends
 * beneath its base path.
 *
 * Resolution order per request lives in `src/lib/agent-resolution.ts`.
 * Resolution runs per request; the handler, runtime and agent it produces are
 * MEMOISED per resolution in `src/lib/demo-runtime.ts` — read the header
 * comment there before touching the cache key, because per-demo isolation now
 * depends on it.
 */

import { handleDemoRequest } from "@/lib/demo-runtime";

/**
 * Demo ids owned by sibling route files, which this route must never serve.
 * Keep in step with the sibling directories under `src/app/api/[integration]`.
 */
const SIBLING_ROUTE_DEMOS = new Set(["auth", "voice"]);

// Manifests are read from disk and env vars are read per request, so this
// route can never be statically evaluated.
export const dynamic = "force-dynamic";

type RouteParams = { integration: string; demo: string; slug?: string[] };

async function serve(
  req: Request,
  ctx: { params: Promise<RouteParams> },
): Promise<Response> {
  const { integration, demo } = await ctx.params;

  if (SIBLING_ROUTE_DEMOS.has(demo)) {
    return new Response(
      JSON.stringify({
        error: "not_found",
        message:
          `Demo "${demo}" is served by its own route file, not by the generic ` +
          `[demo] route: it needs behaviour no manifest can carry. Request ` +
          `/api/${integration}/${demo} so Next.js matches the static segment.`,
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  return handleDemoRequest(req, {
    routeId: "generic",
    slug: integration,
    demoId: demo,
    basePath: `/api/${integration}/${demo}`,
    // SINGLE-ROUTE, because that is what the pages this route serves speak.
    //
    // Every demo page under `src/app/[integration]/demos/` mounts
    // `<CopilotKit>` from `@copilotkit/react-core/v2`. That export is NOT the
    // V2 provider — it is the V1 compatibility wrapper
    // (`packages/react-core/src/v2/index.ts` re-exports
    // `components/copilot-provider/copilotkit`), and it applies
    // `useSingleEndpoint={props.useSingleEndpoint ?? true}`. So unless a page
    // opts out, its client runs the SINGLE-ENDPOINT transport: one
    // `POST <basePath>` carrying `{"method":"info"}`, then
    // `{"method":"agent/run", …}`. It never requests `/info` or
    // `/agent/:id/run` as URLs.
    //
    // Under `"multi-route"` that base-path POST matches no route and answers
    // `404 {"error":"Not found"}` with nothing logged — a rendered chat that
    // cannot reach its agent. Do not "modernise" this to multi-route without
    // also changing every page's transport; the test named below fails if the
    // two drift apart.
    mode: "single-route",
  });
}

export const GET = serve;
export const POST = serve;
export const PUT = serve;
export const DELETE = serve;
export const OPTIONS = serve;
