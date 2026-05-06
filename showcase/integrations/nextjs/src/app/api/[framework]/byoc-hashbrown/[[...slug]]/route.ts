// showcase/integrations/nextjs/src/app/api/[framework]/byoc-hashbrown/[[...slug]]/route.ts
//
// Dedicated runtime for the BYOC Hashbrown demo.
//
// The byoc-hashbrown backend factory (src/agents/byoc_hashbrown.py) is
// mounted at /<demo-id>/ on the Strands server. The system prompt is baked
// into the factory — no forwardedProps.additional_instructions needed.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { frameworks } from "@/registry/frameworks";
import type { FrameworkSlug } from "@/registry/frameworks";

const DEMO_ID = "byoc-hashbrown";

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
      [DEMO_ID]: new HttpAgent({ url: `${fw.backendUrl}/${DEMO_ID}/` }),
    },
  });

  return createCopilotRuntimeHandler({
    runtime,
    basePath: `/api/${fwSlug}/${DEMO_ID}`,
  })(req);
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
