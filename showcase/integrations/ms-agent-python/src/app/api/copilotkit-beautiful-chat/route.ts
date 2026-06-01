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

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Single shared agent instance. Earlier this file created two independent
// HttpAgent objects (one for "beautiful-chat", one for "default"); the chat
// drove the "beautiful-chat" instance, the canvas read `useAgent()` which
// resolved to "default", and the STATE_SNAPSHOT delivered by the chat run
// never reached the canvas's agent.state. Sharing one instance fixes the
// Task Manager pill — the canvas's `agent.state.todos` updates as soon as
// the chat agent receives a STATE_SNAPSHOT from `manage_todos`.
const beautifulChatAgent: AbstractAgent = new HttpAgent({
  url: `${AGENT_URL}/beautiful-chat`,
});

const agents: Record<string, AbstractAgent> = {
  // The page's <CopilotKit agent="beautiful-chat"> resolves here.
  "beautiful-chat": beautifulChatAgent,
  // Internal components (example-canvas) call `useAgent()` with no args,
  // which defaults to agentId "default". Alias to the SAME instance so
  // state pushed via the chat reaches the canvas.
  default: beautifulChatAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
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
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
