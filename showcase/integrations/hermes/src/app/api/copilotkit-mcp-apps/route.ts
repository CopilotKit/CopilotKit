import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { HermesAgent } from "@ag-ui/hermes";

// Dedicated runtime for the MCP Apps cell.
//
// Isolated here — mirroring langgraph-python's copilotkit-mcp-apps route —
// because the `mcpApps.servers` config auto-applies the MCP Apps middleware
// to every registered agent. Keeping it on its own route protects the other
// green demos on /api/copilotkit from having the Excalidraw MCP tool set
// injected into their agent calls.
//
// The `mcpApps.servers` config is all you need server-side. On each MCP tool
// call the runtime middleware fetches the associated UI resource from the
// configured server and emits an `activity` event that the built-in
// `MCPAppsActivityRenderer` (registered by CopilotKit internally) renders
// inline in the chat as a sandboxed iframe. The agent is agnostic to this —
// it just emits a `create_view` tool call (driven by the aimock fixture under
// aimock, or by the model live) and the runtime resolves it against the
// remote MCP server at request time.
//
// Hermes serves every run from a single AG-UI endpoint (POST /) on :8000, so
// the "mcp-apps" agent name maps to the same HttpAgent at the root URL.
//
// Reference:
// https://docs.copilotkit.ai/generative-ui/mcp-apps

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HermesAgent({ url: `${AGENT_URL}/` });
}

const agents: Record<string, AbstractAgent> = {
  "mcp-apps": createAgent(),
  // headless-complete shares this runtime because its cell also exercises
  // MCP Apps activity rendering (via a hand-rolled `useRenderActivityMessage`
  // in `demos/headless-complete/chat/message-list.tsx`). Mirrors
  // langgraph-python's copilotkit-mcp-apps route, which registers both the
  // `mcp-apps` and `headless-complete` agents on one MCP-apps-enabled runtime.
  "headless-complete": createAgent(),
};

// @region[runtime-mcpapps-config]
// The runtime auto-applies the MCP Apps middleware to every registered agent:
// on each MCP tool call it fetches the associated UI resource and emits an
// `activity` event that the built-in `MCPAppsActivityRenderer` renders inline.
const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
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
