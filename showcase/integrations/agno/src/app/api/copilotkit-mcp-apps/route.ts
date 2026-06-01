// CopilotKit runtime for the MCP Apps cell (Agno).
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware to the
// agent: when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` (registered by CopilotKit internally)
// renders in the chat as a sandboxed iframe.
//
// We attach a no-tools Agno agent here (the main agent at /agui has its own
// rich tool catalog; an MCP-only cell is cleaner with no competing tools).
// The MCP Apps middleware injects the MCP server's tools into the agent's
// catalog at request time so the LLM can call them.
//
// Reference:
// https://docs.copilotkit.ai/integrations/agno/generative-ui/mcp-apps

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Backed by the Agno main AGUI interface. The MCP Apps middleware wires
// MCP server tools into the run alongside whatever tools the agent already
// has — for the cleanest UX the dedicated `/mcp-apps/agui` interface (see
// agent_server.py) registers a no-tools Agno agent so the LLM only sees
// the MCP-provided toolset.
const mcpAppsAgent = new HttpAgent({ url: `${AGENT_URL}/mcp-apps/agui` });

// @region[runtime-mcpapps-config]
// The `mcpApps.servers` config is all you need server-side. The runtime
// auto-applies the MCP Apps middleware: on each MCP tool call it fetches
// the associated UI resource and emits an `activity` event that the
// built-in `MCPAppsActivityRenderer` renders inline in the chat.
const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts; published CopilotRuntime's `agents`
  // type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects
  // plain Records. Fixed in source, pending release.
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
