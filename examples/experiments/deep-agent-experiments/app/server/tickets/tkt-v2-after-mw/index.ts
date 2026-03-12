// ---------------------------------------------------------------------------
// tkt-v2-after-mw: afterRequestMiddleware receives consumed Response body
//
// Issue: In v2, afterRequestMiddleware only provides { runtime, response, path }.
// The response body (SSE stream) has already been piped to the client by the
// time middleware runs, so response.text() / response.body.getReader() fails.
//
// In v1, onAfterRequest provided { outputMessages: Message[] } — structured,
// parsed output messages useful for telemetry and logging.
//
// This reproduction uses createCopilotEndpointSingleRoute (Hono-based, the
// default v2 endpoint) because our Fastify server bridges via handler.fetch().
// The Express variant (createCopilotEndpointSingleRouteExpress) has the SAME
// issue — see express-single.ts lines 173-174:
//
//   await sendFetchResponse(res, response);  // body consumed
//   callAfterRequestMiddleware(...)           // too late
//
// Slack thread: https://copilotkit.slack.com/archives/C09C1BLEPC1/p1769639928266649
// ---------------------------------------------------------------------------

import { CopilotRuntime } from "@copilotkitnext/runtime";
import { createCopilotEndpointSingleRoute } from "@copilotkitnext/runtime";
import { HttpAgent } from "@ag-ui/client";

const agentBaseUrl =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8000";

const agentUrl = `${agentBaseUrl}/tickets/tkt-v2-after-mw`;

console.log("[tkt-v2-after-mw server] Agent URL:", agentUrl);

const agent = new HttpAgent({
  url: agentUrl,
});

// ---------------------------------------------------------------------------
// v2 CopilotRuntime with afterRequestMiddleware
//
// This is the core of the issue: the middleware receives a Response object,
// but the body stream has either been consumed (Express) or is about to be
// consumed (Hono). There is no access to parsed output messages.
// ---------------------------------------------------------------------------

const runtime = new CopilotRuntime({
  agents: { default: agent },

  afterRequestMiddleware: async ({ response, path, messages, threadId, runId }) => {
    console.log("[tkt-v2-after-mw server] ──────────────────────────────────");
    console.log("[tkt-v2-after-mw server] afterRequestMiddleware CALLED");
    console.log("[tkt-v2-after-mw server] path:", path);
    console.log("[tkt-v2-after-mw server] response.status:", response.status);
    console.log("[tkt-v2-after-mw server] response.headers:", Object.fromEntries(response.headers.entries()));
    console.log("[tkt-v2-after-mw server] response.bodyUsed:", response.bodyUsed);
    try {
      const body = await response.text();
      console.log("[tkt-v2-after-mw server] response body length:", body.length);
      console.log("[tkt-v2-after-mw server] response body (first 500 chars):", body.slice(0, 500));
    } catch (err: any) {
      console.error("[tkt-v2-after-mw server] response.text() FAILED:", err.message);
    }
    console.log("[tkt-v2-after-mw server] threadId:", threadId);
    console.log("[tkt-v2-after-mw server] runId:", runId);
    console.log("[tkt-v2-after-mw server] messages:", JSON.stringify(messages, null, 2));
    console.log("[tkt-v2-after-mw server] message count:", messages?.length ?? 0);
    console.log("[tkt-v2-after-mw server] ──────────────────────────────────");
  },

  beforeRequestMiddleware: async ({ request, path }) => {
    console.log("[tkt-v2-after-mw server] beforeRequestMiddleware called");
    console.log("[tkt-v2-after-mw server] path:", path);

    // Before-request works fine — we can read request details for telemetry.
    // The gap is specifically in AFTER-request (output messages).
  },
});

// ---------------------------------------------------------------------------
// Create the Hono-based single-route endpoint.
//
// The user's original code used createCopilotEndpointSingleRouteExpress from
// "@copilotkitnext/runtime/express" — which returns an Express Router. Our
// Fastify server bridges via handler(Request) → Response, so we use the Hono
// variant which exposes app.fetch(Request) → Response.
//
// The afterRequestMiddleware behavior is IDENTICAL in both variants:
//   - Express: sendFetchResponse() consumes body, THEN calls middleware
//   - Hono: middleware runs after handler but body will be consumed by .fetch()
// ---------------------------------------------------------------------------

const app = createCopilotEndpointSingleRoute({
  runtime,
  // basePath is "/" because our Fastify bridge already routes to this handler
  // based on the discovered endpoint path. The Hono app only needs to match "/".
  basePath: "/",
});

console.log("[tkt-v2-after-mw server] Endpoint created at /api/tickets/tkt-v2-after-mw/copilot");

// Export a handler compatible with our Fastify bridge (Request → Response).
// Rewrite the URL path to "/" so Hono's basePath routing matches.
export const handler = (request: Request) => {
  const url = new URL(request.url);
  console.log("[tkt-v2-after-mw server] Incoming request:", request.method, url.pathname);
  url.pathname = "/";
  return app.fetch(new Request(url, request));
};
