// CopilotKit runtime for the MCP Apps cell.
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware to
// the agent: when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` renders in the chat as a sandboxed
// iframe.
//
// The LlamaIndex port points at the same Excalidraw MCP server; the agent
// at `/mcp-apps/run` has no bespoke tools — MCP tools are injected by the
// runtime middleware at request time.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const mcpAppsAgent = new HttpAgent({ url: `${AGENT_URL}/mcp-apps/run` });

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "mcp-apps": mcpAppsAgent as AbstractAgent,
  },
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
