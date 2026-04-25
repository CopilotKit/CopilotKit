// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Combines Open Generative UI + A2UI (with `injectA2UITool: false` because
// the backend crew owns the generate_a2ui tool) on a single runtime. The
// LangGraph reference also wires `mcpApps.servers` for an Excalidraw MCP
// server; CrewAI has no MCP multiplexer (see src/agents/beautiful_chat.py
// header) so the MCP leg is omitted here and the corresponding suggestion
// pill is removed from the frontend.
//
// Agent URL points at the dedicated `/beautiful-chat` FastAPI endpoint
// mounted by `agent_server.py`.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/beautiful-chat` });
}

const agents: Record<string, AbstractAgent> = {
  "beautiful-chat": createAgent(),
  // Internal components (headless-chat, example-canvas) call `useAgent()`
  // with no args, which defaults to agentId "default". Alias to the same
  // crew so those component hooks resolve instead of throwing.
  default: createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  openGenerativeUI: true,
  a2ui: {
    // Backend crew owns its own generate_a2ui tool; don't double-inject.
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
