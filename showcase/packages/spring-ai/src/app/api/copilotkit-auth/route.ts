// Dedicated runtime for the /demos/auth cell.
//
// Demonstrates framework-native request authentication via the V2 runtime's
// `onRequest` hook, which runs before routing and can short-circuit by
// throwing a Response. We validate a static `Authorization: Bearer
// <DEMO_TOKEN>` header; mismatch throws 401 before the request reaches the
// underlying Spring AI HttpAgent.

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { DEMO_AUTH_HEADER } from "@/app/demos/auth/demo-token";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const authDemoAgent = new HttpAgent({ url: `${AGENT_URL}/` });

const runtime = new CopilotRuntime({
  // @ts-ignore - agents type shape as in main route
  agents: {
    auth: authDemoAgent,
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

export const POST = (req: NextRequest) => handler(req);
export const GET = (req: NextRequest) => handler(req);
