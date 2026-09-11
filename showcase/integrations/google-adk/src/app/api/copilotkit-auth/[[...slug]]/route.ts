// Catch-all owns the V2 runtime endpoint, including the base path and its
// /info, /agent/:id/run, and other subpaths. Next.js rejects a sibling
// route.ts because it has equal specificity at the base path.

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

import { DEMO_AUTH_HEADER } from "@/app/demos/auth/demo-token";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";
const BASE_PATH = "/api/copilotkit-auth";

function buildHandler(forwardedHeaders: Record<string, string>) {
  const authDemoAgent = new HttpAgent({
    url: `${AGENT_URL}/auth`,
    headers: forwardedHeaders,
  });
  const runtime = new CopilotRuntime({
    agents: { "auth-demo": authDemoAgent, default: authDemoAgent },
  });
  return createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    hooks: {
      onRequest: ({ request }) => {
        if (request.headers.get("authorization") !== DEMO_AUTH_HEADER) {
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
    },
  });
}

export const POST = (req: NextRequest) =>
  buildHandler(extractForwardedHeaders(req))(req);
export const GET = (req: NextRequest) =>
  buildHandler(extractForwardedHeaders(req))(req);
