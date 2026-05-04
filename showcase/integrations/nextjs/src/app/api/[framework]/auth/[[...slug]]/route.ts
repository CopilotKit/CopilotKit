// showcase/integrations/nextjs/src/app/api/[framework]/auth/[[...slug]]/route.ts
//
// Demonstrates framework-native request authentication via the V2 runtime's
// `onRequest` hook. A static `Authorization: Bearer <DEMO_TOKEN>` header is
// required; mismatch throws a 401 before the request reaches the agent.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { frameworks } from "@/registry/frameworks";
import type { FrameworkSlug } from "@/registry/frameworks";
import { DEMO_AUTH_HEADER } from "@/app/demos/[framework]/auth/demo-token";

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ framework: string }> },
) {
  const { framework: fwSlug } = await ctx.params;
  const fw = frameworks[fwSlug as FrameworkSlug];
  if (!fw)
    return NextResponse.json({ error: "unknown framework" }, { status: 404 });
  if (fw.backendUrl === "")
    return NextResponse.json(
      { error: "backend not configured" },
      { status: 503 },
    );

  const runtime = new CopilotRuntime({
    agents: {
      // @ts-ignore -- HttpAgent satisfies the agent contract at runtime; type mismatch fixed pending release
      auth: new HttpAgent({ url: `${fw.backendUrl}/auth/` }),
    },
  });

  return createCopilotRuntimeHandler({
    runtime,
    basePath: `/api/${fwSlug}/auth`,
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
  })(req);
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
