// Dedicated runtime for the Beautiful Chat flagship showcase cell (Mastra).
//
// Beautiful Chat simultaneously exercises A2UI (dynamic + fixed schema),
// Open Generative UI, and MCP Apps. This route enables all three flags on
// a single runtime backing one shared Mastra agent — keeping these global
// runtime flags scoped to the flagship cell so other demos sharing the
// main `/api/copilotkit` endpoint preserve their per-demo
// `useFrontendTool` / `useComponent` registrations.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";

const beautifulChatAgent = getLocalAgent({
  mastra,
  agentId: "weatherAgent",
  resourceId: "mastra-beautiful-chat",
});

if (!beautifulChatAgent) {
  throw new Error(
    "getLocalAgent returned null for weatherAgent — required for /demos/beautiful-chat",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "beautiful-chat": beautifulChatAgent,
    // Internal components call useAgent() with no args (defaults to "default").
    default: beautifulChatAgent,
  },
  openGenerativeUI: true,
  a2ui: {
    // weatherAgent already has its own `generate_a2ui` tool — don't double-bind.
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
