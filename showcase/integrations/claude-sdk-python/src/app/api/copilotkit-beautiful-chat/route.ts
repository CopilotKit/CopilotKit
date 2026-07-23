// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat exercises A2UI, Open Generative UI, and MCP Apps in one
// runtime, matching the canonical langgraph-python topology.

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agents: Record<string, AbstractAgent> = {
  "beautiful-chat": createClaudeHttpAgent(`${AGENT_URL}/beautiful-chat`),
  default: createClaudeHttpAgent(`${AGENT_URL}/beautiful-chat`),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  openGenerativeUI: true,
  a2ui: {
    injectA2UITool: false,
    defaultCatalogId: "copilotkit://app-dashboard-catalog",
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
      endpoint: "/api/copilotkit-beautiful-chat",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    return internalRuntimeErrorResponse(
      "/api/copilotkit-beautiful-chat",
      error,
    );
  }
};
