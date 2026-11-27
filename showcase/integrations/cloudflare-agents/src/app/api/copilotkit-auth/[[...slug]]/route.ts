// Dedicated runtime for the /demos/auth cell.
//
// Demonstrates framework-native request authentication via the V2 runtime's
// `onRequest` hook. A static `Authorization: Bearer <DEMO_TOKEN>` header is
// required; mismatch throws a 401 before the request reaches the agent.

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { cloudflareAgent, withForwardedHeaders } from "@/lib/cloudflare-agents";
import { DEMO_AUTH_HEADER } from "@/app/demos/auth/demo-token";

function createAgent() {
  return cloudflareAgent("showcase");
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

export const POST = (req: NextRequest) =>
  withForwardedHeaders(req, () => handler(req));
export const GET = (req: NextRequest) =>
  withForwardedHeaders(req, () => handler(req));
