// CopilotKit runtime for the MCP Apps cell.
//
// The MCP Apps middleware runs on the NextJS runtime layer — it adds MCP
// server tools to the AG-UI tools list forwarded to the agent, and when
// the agent calls an MCP tool the middleware fetches the associated UI
// resource and emits an `activity` event. The built-in
// `MCPAppsActivityRenderer` registered by CopilotKitProvider renders the
// sandboxed iframe.
//
// For the Spring AI backend, the Spring-AI ChatClient sees the extra MCP
// tools via the standard `tools` field in the AG-UI request; the MCP
// activity rendering is driven entirely by the runtime + frontend.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const agents: Record<string, AbstractAgent> = {
  "mcp-apps": createAgent(),
};

// @region[runtime-mcpapps-config]
const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        serverId: "excalidraw",
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
