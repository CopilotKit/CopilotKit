// CopilotKit runtime for the MCP Apps cell (MS Agent Framework backend).
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware to the
// agent: when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` (registered by CopilotKit internally)
// renders in the chat as a sandboxed iframe.
//
// The dedicated MCP Apps agent is served by the FastAPI backend at
// `${AGENT_URL}/mcp-apps` (see src/agent_server.py).
//
// Reference:
// https://docs.copilotkit.ai/integrations/microsoft-agent-framework/generative-ui/mcp-apps

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log("[copilotkit-mcp-apps/route] Initializing CopilotKit runtime");
console.log(`[copilotkit-mcp-apps/route] AGENT_URL: ${AGENT_URL}`);

const mcpAppsAgent = new HttpAgent({ url: `${AGENT_URL}/mcp-apps/` });

// @region[runtime-mcpapps-config]
// The `mcpApps.servers` config is all you need server-side. The runtime
// auto-applies the MCP Apps middleware to every registered agent: on each
// MCP tool call it fetches the associated UI resource and emits an
// `activity` event that the built-in `MCPAppsActivityRenderer` renders
// inline in the chat.
const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents: {
    "mcp-apps": mcpAppsAgent,
  },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        // Always pin a stable `serverId`. Without it CopilotKit hashes the
        // URL, and a URL change silently breaks restoration of persisted
        // MCP Apps in prior conversation threads.
        serverId: "mcp_apps_server",
      },
    ],
  },
});
// @endregion[runtime-mcpapps-config]

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-mcp-apps",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
