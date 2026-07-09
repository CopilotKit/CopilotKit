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
// Backend wiring: CST's `agent_server.ts` has no dedicated `beautiful_chat`
// mount (unlike LGP/PydanticAI which ship a per-cell graph). CST is a
// frontend-driven pass-through: every demo's distinctive behaviour comes
// from frontend-registered tools + runtime-injected middleware (a2ui,
// openGenerativeUI, mcpApps). We therefore proxy to the pass-through `/`
// mount — the same target used by `copilotkit-mcp-apps/route.ts` and the
// other dedicated CST runtimes whose backends are middleware-driven.
// Limitation: the langgraph-python `beautiful_chat` graph also owns a
// backend `generate_a2ui` + `search_flights` tool pair; CST relies on the
// A2UI middleware + frontend tooling to provide equivalent behaviour.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { createGatewayAgent } from "@/lib/openclaw-agent";

// The beautiful-chat page resolves <CopilotKit agent="beautiful-chat">
// here; internal components (headless-chat, example-canvas) also call
// `useAgent()` with no args, which defaults to agentId "default". Alias
// default to the same pass-through backend so those hooks resolve.
const agents: Record<string, AbstractAgent> = {
  "beautiful-chat": createGatewayAgent(),
  default: createGatewayAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  openGenerativeUI: true,
  a2ui: {
    // Do NOT inject a competing runtime render_a2ui tool. Frontend +
    // middleware own the a2ui surface here.
    injectA2UITool: false,
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
    // Log the full error server-side under an opaque id; return only the id.
    // Returning error.message/stack leaks server internals (paths, versions,
    // env-derived values) to any caller. Matches copilotkit-subagents/route.ts.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        route: "/api/copilotkit-beautiful-chat",
        errorId,
        message: err.message,
        stack: err.stack,
      }),
    );
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};
