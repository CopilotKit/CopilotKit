// CopilotKit runtime for the MCP Apps cell.
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware to the
// agent: when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` renders in the chat as a sandboxed iframe.
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-mcp-apps/route.ts
// - src/agents/mcp_apps_agent.py (the AG2 backend, no bespoke tools)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const mcpAppsAgent = new HttpAgent({ url: `${AGENT_URL}/mcp-apps/` });

const headlessCompleteAgent = new HttpAgent({
  url: `${AGENT_URL}/headless-complete/`,
});

// @region[runtime-mcpapps-config]
// The `mcpApps.servers` config is all you need server-side. The runtime
// auto-applies the MCP Apps middleware to every registered agent: on each
// MCP tool call it fetches the associated UI resource and emits an
// `activity` event that the built-in `MCPAppsActivityRenderer` renders
// inline in the chat.
const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "mcp-apps": mcpAppsAgent,
    // headless-complete shares this runtime because its cell also exercises
    // MCP Apps rendering (via a hand-rolled `useRenderActivityMessage` in
    // `use-rendered-messages.tsx`).
    "headless-complete": headlessCompleteAgent,
  },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        // Pin a stable `serverId`. Without it CopilotKit hashes the URL and
        // a URL change silently breaks restoration of persisted MCP Apps in
        // prior conversation threads.
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
