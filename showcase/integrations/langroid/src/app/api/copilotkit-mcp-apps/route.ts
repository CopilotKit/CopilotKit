// CopilotKit runtime for the MCP Apps cell (Langroid).
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware:
// when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` (registered by CopilotKit
// internally) renders inline in the chat as a sandboxed iframe.
//
// The agent itself is the no-tools FastAPI handler at
// `${AGENT_URL}/mcp-apps` — see `src/agents/mcp_apps_agent.py`. The
// runtime forwards the MCP tool catalog through `RunAgentInput.tools`,
// the agent forwards it to OpenAI, and any tool calls the model emits
// flow back through the middleware.
//
// Reference:
// https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const mcpAppsAgent = new HttpAgent({ url: `${AGENT_URL}/mcp-apps` });

// @region[runtime-mcpapps-config]
const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts for the same-shape mismatch rationale.
  agents: {
    "mcp-apps": mcpAppsAgent,
    default: mcpAppsAgent,
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
