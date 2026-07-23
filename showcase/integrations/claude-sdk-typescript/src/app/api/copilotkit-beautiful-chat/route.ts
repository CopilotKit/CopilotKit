// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat exercises A2UI (dynamic + fixed schema), Open Generative
// UI, and MCP Apps simultaneously — the same combined-runtime shape the
// canonical langgraph-python reference uses.
//
// Mirrors:
//   showcase/integrations/pydantic-ai/src/app/api/copilotkit-beautiful-chat/route.ts
//   showcase/integrations/langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts
//
// Backend wiring: CST exposes a dedicated `/beautiful-chat` agentic-loop
// mount because this flagship cell mixes backend-owned tools
// (`query_data`, `search_flights`, `generate_a2ui`, `manage_todos`) with
// frontend tools and middleware-provided tools. Proxying to the default `/`
// pass-through leaves backend tool calls unresolved.

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

// The beautiful-chat page resolves <CopilotKit agent="beautiful-chat">
// here; internal components (headless-chat, example-canvas) also call
// `useAgent()` with no args, which defaults to agentId "default". Alias
// default to the same pass-through backend so those hooks resolve.
const agents: Record<string, AbstractAgent> = {
  "beautiful-chat": createClaudeHttpAgent(`${AGENT_URL}/beautiful-chat`),
  default: createClaudeHttpAgent(`${AGENT_URL}/beautiful-chat`),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  openGenerativeUI: true,
  a2ui: {
    // Do NOT inject a competing runtime render_a2ui tool. Frontend +
    // middleware own the a2ui surface here.
    injectA2UITool: false,
    // Models follow the tool-usage guide and omit `catalogId`, and the
    // middleware then falls back to the unregistered spec basic catalog
    // ("Catalog not found" render error). Pin the catalog the page registers.
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
