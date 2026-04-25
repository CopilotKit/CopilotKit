/**
 * Dedicated runtime for the /demos/auth cell — Claude Agent SDK port.
 *
 * Demonstrates framework-native request authentication via the V2
 * runtime's `onRequest` hook, which runs before routing and can
 * short-circuit the request by throwing a Response. Validates a static
 * `Authorization: Bearer <DEMO_TOKEN>` header; mismatch throws 401 before
 * the request reaches the agent.
 *
 * Implementation note: the V1 Next.js adapter
 * (`copilotRuntimeNextJSAppRouterEndpoint`) does NOT forward the `hooks`
 * option to the V2 fetch handler. To get `onRequest` wired we use
 * `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2` directly —
 * the framework-agnostic fetch handler that returns a plain
 * `(Request) => Promise<Response>`, which composes cleanly with a
 * Next.js App Router route export.
 */

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { DEMO_AUTH_HEADER } from "@/app/demos/auth/demo-token";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const authDemoAgent = new HttpAgent({ url: `${AGENT_URL}/` });

const agents: Record<string, AbstractAgent> = {
  "auth-demo": authDemoAgent,
  default: authDemoAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
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
