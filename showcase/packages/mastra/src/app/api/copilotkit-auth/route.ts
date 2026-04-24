// Dedicated runtime for the /demos/auth cell (Mastra).
//
// Demonstrates framework-native request authentication via the V2 runtime's
// `onRequest` hook, which runs before routing and can short-circuit the
// request by throwing a Response. We validate a static
// `Authorization: Bearer <DEMO_TOKEN>` header; mismatch throws 401 before
// the request reaches the agent.
//
// Implementation note: the V1 Next.js adapter
// (`copilotRuntimeNextJSAppRouterEndpoint`) does NOT forward the `hooks`
// option to the V2 fetch handler. To get `onRequest` wired, this route
// uses `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2`
// directly — the framework-agnostic fetch handler that returns a plain
// `(Request) => Promise<Response>`, which composes cleanly with a Next.js
// App Router route export.

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { DEMO_AUTH_HEADER } from "@/app/demos/auth/demo-token";

// Reuse the shared `weatherAgent` for the authenticated path. The point of
// this demo is the gate mechanism, not per-user agent branching.
const authDemoAgent = getLocalAgent({
  mastra,
  agentId: "weatherAgent",
  resourceId: "mastra-auth-demo",
});

if (!authDemoAgent) {
  throw new Error(
    "getLocalAgent returned null for weatherAgent — required for /demos/auth",
  );
}

const runtime = new CopilotRuntime({
  agents: {
    "auth-demo": authDemoAgent,
    // Fallback: useAgent() with no args resolves "default" — alias to the
    // same agent so hooks in the demo page resolve cleanly.
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
              "Missing or invalid Authorization header. Click Sign in above to send messages.",
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
// POST/GET exports without any adapter shim.
export const POST = (req: NextRequest) => handler(req);
export const GET = (req: NextRequest) => handler(req);
