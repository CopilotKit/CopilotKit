// CopilotKit runtime for the MCP Apps cell (CrewAI Crews backend).
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware to the
// agent: when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` (registered by CopilotKit internally)
// renders in the chat as a sandboxed iframe.
//
// The dedicated MCP Apps crew is served by the FastAPI agent server at
// `${AGENT_URL}/mcp-apps` (see src/agent_server.py).
//
// Reference:
// https://docs.copilotkit.ai/integrations/crewai-crews/generative-ui/mcp-apps

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const mcpAppsAgent = new HttpAgent({ url: `${AGENT_URL}/mcp-apps/` });

// headless-complete shares this runtime (its page wires
// runtimeUrl="/api/copilotkit-mcp-apps") but is backed by the shared
// LatestAiDevelopment crew on "/" — the same backend the main route
// registers it against.
const headlessCompleteAgent = new HttpAgent({ url: `${AGENT_URL}/` });

// @region[runtime-mcpapps-config]
// The `mcpApps.servers` config is all you need server-side. The runtime
// auto-applies the MCP Apps middleware to every registered agent: on each
// MCP tool call it fetches the associated UI resource and emits an
// `activity` event that the built-in `MCPAppsActivityRenderer` renders
// inline in the chat.
const runtime = new CopilotRuntime({
  // The `as AbstractAgent` casts below narrow each entry to the type
  // CopilotRuntime's `agents` map expects; see main route.ts for the
  // underlying published-type quirk (MaybePromise<NonEmptyRecord<...>>
  // around the Record). Fixed in source, pending release.
  agents: {
    "headless-complete": headlessCompleteAgent as AbstractAgent,
    "mcp-apps": mcpAppsAgent as AbstractAgent,
  },
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
