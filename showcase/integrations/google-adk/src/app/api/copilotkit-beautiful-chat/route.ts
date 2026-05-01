// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat simultaneously exercises A2UI (dynamic + fixed schema),
// Open Generative UI, and MCP Apps. The main `/api/copilotkit` runtime
// keeps those global flags OFF so per-demo `useFrontendTool` /
// `useComponent` registrations in non-flagship cells stay isolated. This
// route enables the combined-runtime shape for the one cell that needs it.
//
// References:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts
// - showcase/integrations/ms-agent-python/src/app/api/copilotkit-beautiful-chat/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// agent_server.py mounts the ADK middleware at /<agent_name>; the registry
// uses underscore form (`beautiful_chat`) so the backend path matches.
function createBeautifulChatAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/beautiful_chat` });
}

const agents: Record<string, AbstractAgent> = {
  // The page's <CopilotKit agent="beautiful_chat"> resolves here.
  beautiful_chat: createBeautifulChatAgent(),
  // Internal components (example-canvas, headless-chat) call `useAgent()`
  // with no args, which defaults to agentId "default". Alias to the same
  // agent so those component hooks resolve instead of throwing
  // "Agent 'default' not found".
  default: createBeautifulChatAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-expect-error -- see main route.ts; published types reject plain Records.
  agents,
  // Canonical: openGenerativeUI: true, a2ui.injectA2UITool: false, mcpApps.
  openGenerativeUI: true,
  a2ui: {
    // The backend agent owns `generate_a2ui`, so we must NOT inject the
    // runtime's default A2UI tool on top (that would double-bind the tool
    // slot and confuse the LLM).
    injectA2UITool: false,
  },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        // Stable serverId so persisted threads keep restoring the same MCP
        // server across URL changes.
        serverId: "beautiful_chat_mcp",
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
    const e = error as { message?: string; stack?: string };
    console.error("[copilotkit-beautiful-chat]", e);
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
