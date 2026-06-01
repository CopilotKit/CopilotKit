// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat exercises A2UI (dynamic + fixed schema) and Open
// Generative UI. The canonical langgraph-python reference ships MCP
// Apps on the same runtime as well; the PydanticAI port omits MCP Apps
// (see PARITY_NOTES.md).
//
// Mirrors showcase/integrations/langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// The beautiful-chat page resolves <CopilotKit agent="beautiful-chat">
// here; internal components (headless-chat, example-canvas) also call
// `useAgent()` with no args, which defaults to agentId "default". Alias
// default to the same backend so those hooks resolve.
const agents: Record<string, AbstractAgent> = {
  "beautiful-chat": new HttpAgent({ url: `${AGENT_URL}/beautiful_chat/` }),
  default: new HttpAgent({ url: `${AGENT_URL}/beautiful_chat/` }),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  openGenerativeUI: true,
  a2ui: {
    // The backend graph owns `generate_a2ui` + `search_flights`
    // explicitly; do NOT inject a competing runtime render_a2ui tool.
    injectA2UITool: false,
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
