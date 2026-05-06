// showcase/integrations/nextjs/src/app/api/[framework]/mcp-apps/[[...slug]]/route.ts
//
// Dedicated runtime for the MCP Apps demo.
//
// The runtime's `mcpApps.servers` config auto-applies the MCP Apps middleware
// to every registered agent: on each MCP tool call it fetches the associated
// UI resource and emits an `activity` event that the built-in
// `MCPAppsActivityRenderer` renders inline in the chat.
//
// Always pin a stable `serverId`. Without it CopilotKit hashes the URL, and a
// URL change silently breaks restoration of persisted MCP Apps in prior
// conversation threads.
//
// Reference (strands legacy):
// showcase/integrations/strands/src/app/api/copilotkit-mcp-apps/route.ts

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

  // @region[runtime-mcpapps-config]
  const runtime = new CopilotRuntime({
    agents: {
      // @ts-ignore -- HttpAgent satisfies the agent contract at runtime; type mismatch fixed pending release
      "mcp-apps": new HttpAgent({ url: `${fw.backendUrl}/mcp-apps/` }),
    },
    mcpApps: {
      servers: [
        {
          type: "http",
          url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
          // Always pin a stable `serverId`. Without it CopilotKit hashes the
          // URL, and a URL change silently breaks restoration of persisted
          // MCP Apps in prior conversation threads.
          serverId: "excalidraw",
        },
      ],
    },
  });
  // @endregion[runtime-mcpapps-config]

  return createCopilotRuntimeHandler({
    runtime,
    basePath: `/api/${fwSlug}/mcp-apps`,
  })(req);
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
