// Dedicated runtime for the /demos/auth cell (Langroid).
//
// Framework-native request authentication via the V2 runtime's `onRequest`
// hook. Validates a static `Authorization: Bearer <DEMO_TOKEN>` header;
// mismatch throws 401 before the request reaches the agent.
//
// Uses `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2` directly
// so the `hooks.onRequest` option is honored (the V1 Next.js adapter does
// not forward the `hooks` option).

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { DEMO_AUTH_HEADER } from "@/app/demos/auth/demo-token";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Reuse the unified Langroid agent — this demo shows the gate, not bespoke
// auth-aware agent behavior.
const authDemoAgent = new HttpAgent({ url: `${AGENT_URL}/` });

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>>
  agents: {
    "auth-demo": authDemoAgent,
    default: authDemoAgent,
  },
});

const BASE_PATH = "/api/copilotkit-auth";

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: BASE_PATH,
  hooks: {
    onRequest: ({ request }: { request: Request }) => {
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
