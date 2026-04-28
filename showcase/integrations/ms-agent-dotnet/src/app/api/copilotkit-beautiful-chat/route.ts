// Dedicated runtime for the Beautiful Chat flagship cell.
//
// Beautiful Chat simultaneously exercises A2UI (dynamic + fixed schema),
// Open Generative UI, and MCP Apps. Those three flags are set on the
// CopilotRuntime itself (not on the backing agent), so we scope this cell
// to its own route instead of bleeding flags into the shared
// `/api/copilotkit` endpoint used by every other cell.
//
// References:
// - showcase/packages/langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts
// - ../copilotkit-multimodal/route.ts (dedicated-route pattern)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  // Points at the `/beautiful-chat` mount on the .NET backend
  // (Program.cs: `app.MapAGUI("/beautiful-chat", ...)`).
  return new HttpAgent({ url: `${AGENT_URL}/beautiful-chat` });
}

const agents: Record<string, AbstractAgent> = {
  // The page's <CopilotKit agent="beautiful-chat"> resolves here.
  "beautiful-chat": createAgent(),
  // Alias for internal components that call `useAgent()` without args.
  default: createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  openGenerativeUI: true,
  a2ui: {
    // The .NET agent has its own `generate_a2ui` tool; don't inject the
    // runtime's default A2UI tool on top.
    injectA2UITool: false,
  },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
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
