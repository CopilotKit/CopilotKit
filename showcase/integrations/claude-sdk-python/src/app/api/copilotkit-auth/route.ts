// Dedicated runtime for the /demos/auth cell.
//
// Demonstrates framework-native request authentication via the V2
// runtime's `onRequest` hook, which runs before routing and can
// short-circuit the request by throwing a Response. We validate a
// static `Authorization: Bearer <DEMO_TOKEN>` header; mismatch throws
// 401 before the request reaches the agent.
//
// Implementation note: the V1 Next.js adapter
// (`copilotRuntimeNextJSAppRouterEndpoint`) does NOT forward the
// `hooks` option to the V2 fetch handler. To get `onRequest` wired,
// this route uses `createCopilotRuntimeHandler` from
// `@copilotkit/runtime/v2` directly — the framework-agnostic fetch
// handler that returns a plain `(Request) => Promise<Response>`, which
// composes cleanly with a Next.js App Router route export.
//
// References:
// - packages/runtime/src/v2/runtime/core/hooks.ts (onRequest semantics)
// - packages/runtime/src/v2/runtime/__tests__/hooks.test.ts (throw
//   Response pattern)

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { DEMO_AUTH_HEADER } from "@/app/demos/auth/demo-token";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Reuse the neutral shared Claude agent for the authenticated path.
// The point of this demo is the gate mechanism, not per-user agent
// branching — authenticated users get the same behaviour as any other
// neutral demo.
function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const agents: Record<string, AbstractAgent> = {
  "auth-demo": createAgent(),
  // Fallback: useAgent() with no args resolves "default" — alias to
  // the same agent so hooks in the demo page resolve cleanly.
  default: createAgent(),
};

const runtime = new CopilotRuntime({ agents });

const BASE_PATH = "/api/copilotkit-auth";

// Framework-agnostic fetch handler with the auth gate wired up.
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: BASE_PATH,
  hooks: {
    onRequest: ({ request }) => {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== DEMO_AUTH_HEADER) {
        // Throwing a Response short-circuits the pipeline. The runtime
        // maps thrown Responses to the HTTP response verbatim.
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

// Next.js App Router bindings.
export const POST = (req: NextRequest) => handler(req);
export const GET = (req: NextRequest) => handler(req);
