// Dedicated runtime for the /demos/auth cell.
//
// Demonstrates framework-native request authentication via the V2 runtime's
// `onRequest` hook. A static `Authorization: Bearer <DEMO_TOKEN>` header is
// required; mismatch throws a 401 before the request reaches the agent.
//
// Implementation note: the V1 Next.js adapter does NOT forward `hooks` to the
// V2 fetch handler, so this route uses `createCopilotRuntimeHandler` from
// `@copilotkit/runtime/v2` directly (matches LGP auth route).
//
// HttpAgent → AGENT_URL/ (auth gate is runtime-side; B6 may later mount a
// dedicated /auth/ agent if desired).

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { DEMO_AUTH_HEADER } from "@/app/demos/auth/demo-token";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const authDemoAgent = createAgent();

const runtime = new CopilotRuntime({
  agents: {
    // @ts-ignore -- HttpAgent is structurally compatible with AbstractAgent but misses the private `_debug*` fields in the published .d.ts.
    "auth-demo": authDemoAgent,
    // @ts-ignore
    default: authDemoAgent,
  },
});

const BASE_PATH = "/api/copilotkit-auth";

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: BASE_PATH,
  hooks: {
    onRequest: ({ request }) => {
      if (ROUTE_DEBUG) {
        console.log(
          `[copilotkit-auth/route] onRequest ${request.method} ${request.url}`,
        );
      }
      const authHeader = request.headers.get("authorization");
      if (authHeader !== DEMO_AUTH_HEADER) {
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

export const POST = (req: NextRequest) => handler(req);
export const GET = (req: NextRequest) => handler(req);
