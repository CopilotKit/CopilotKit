// Dedicated runtime for the /demos/auth cell.
//
// Demonstrates framework-native request authentication via the V2 runtime's
// `onRequest` hook, which runs before routing and can short-circuit the
// request by throwing a Response. We validate a static `Authorization: Bearer
// <DEMO_TOKEN>` header; mismatch throws 401 before the request reaches the
// agent.
//
// Implementation note: this route uses `createCopilotRuntimeHandler` from
// `@copilotkit/runtime/v2` directly (not the V1 Next.js adapter) because the
// V1 adapter's `copilotRuntimeNextJSAppRouterEndpoint` does NOT forward the
// `hooks` option to the V2 fetch handler. Using the framework-agnostic fetch
// handler lets us wire `onRequest` in cleanly.
//
// Routing note: the handler runs in default `multi-route` mode, where the
// V2 client hits subpaths like `/info`, `/agent/:agentId/run`, and
// `/agent/:agentId/connect` under the base path. To make Next.js forward
// every one of those subpaths to this handler, the route file lives under a
// catch-all segment (`[[...slug]]`). Without the catch-all, Next.js only
// matches the exact `/api/copilotkit-auth` URL and every subpath (including
// `/info`) returns a framework-level 404 before this handler ever runs —
// which is what caused the original "Runtime info request failed with status
// 404" and "Agent execution failed: HTTP 404" errors.
//
// References:
// - packages/runtime/src/v2/runtime/core/hooks.ts (onRequest semantics)
// - packages/runtime/src/v2/runtime/__tests__/hooks.test.ts (throw Response pattern)

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { DEMO_AUTH_HEADER } from "@/app/demos/auth/demo-token";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

// Reuse the neutral `sample_agent` graph for the authenticated path. The
// point of this demo is the gate mechanism, not per-user agent branching —
// authenticated users get the same behavior as any other neutral demo.
const authDemoAgent = new LangGraphAgent({
  deploymentUrl: LANGGRAPH_URL,
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const runtime = new CopilotRuntime({
  agents: {
    // The page's <CopilotKit agent="auth-demo"> and <CopilotChat
    // agentId="auth-demo"> resolve to this entry.
    "auth-demo": authDemoAgent,
    // Fallback: useAgent() with no args resolves "default" — alias to the
    // same agent so hooks inside the demo page resolve cleanly.
    default: authDemoAgent,
  },
});

const BASE_PATH = "/api/copilotkit-auth";

// Framework-agnostic fetch handler with the auth gate wired up.
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: BASE_PATH,
  hooks: {
    onRequest: ({ request }) => {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== DEMO_AUTH_HEADER) {
        // Throwing a Response short-circuits the pipeline. The runtime maps
        // thrown Responses to the HTTP response verbatim (status + body).
        throw new Response(
          JSON.stringify({
            error: "unauthorized",
            message:
              "Missing or invalid Authorization header. Click Authenticate above to send messages.",
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        );
      }
    },
  },
});

// Next.js App Router bindings. The handler is framework-agnostic — it takes
// a web Request and returns a web Response — so it drops straight into the
// POST/GET exports without any adapter shim. The catch-all segment
// `[[...slug]]` ensures Next.js forwards every subpath (e.g. `/info`,
// `/agent/:agentId/run`, `/agent/:agentId/connect`) to this handler.
export const POST = (req: NextRequest) => handler(req);
export const GET = (req: NextRequest) => handler(req);
