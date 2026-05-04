import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { frameworks } from "@/registry/frameworks";
import type { FrameworkSlug } from "@/registry/frameworks";

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
      "chat-customization-css": new HttpAgent({
        url: `${fw.backendUrl}/chat-customization-css/`,
      }),
    },
  });

  return createCopilotRuntimeHandler({
    runtime,
    basePath: `/api/${fwSlug}/chat-customization-css`,
  })(req);
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
