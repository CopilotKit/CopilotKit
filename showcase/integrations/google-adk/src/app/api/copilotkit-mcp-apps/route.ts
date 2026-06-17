// CopilotKit runtime for the MCP Apps cell (Google ADK).
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware to the
// agent: when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` (registered by CopilotKit internally)
// renders in the chat as a sandboxed iframe.
//
// Reference:
// https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export const POST = async (req: NextRequest) => {
  try {
    // Per-request build conveys inbound `x-aimock-context` to the Python
    // agent_server. See `src/lib/header-forwarding.ts`.
    const headers = extractForwardedHeaders(req);
    const mcpAppsAgent: AbstractAgent = new HttpAgent({
      // Backend mounts this agent at `/mcp-apps` (dash) per
      // agents/registry.py — not `/mcp_apps`. Stale underscore here caused
      // every MCP Apps request to 404 at the ADK FastAPI layer, surfacing
      // as `HTTP 404: {"detail":"Not Found"}` in the chat.
      url: `${AGENT_URL}/mcp-apps`,
      headers,
    });

    // headless-complete shares this runtime because its cell also exercises
    // MCP Apps rendering (via useRenderActivityMessage). The backend path
    // `/headless_complete` is mounted by the ADK agent_server from the
    // registry entry of the same name (mapped to _simple_chat).
    const headlessCompleteAgent: AbstractAgent = new HttpAgent({
      url: `${AGENT_URL}/headless_complete`,
      headers,
    });

    // @region[runtime-mcpapps-config]
    // The `mcpApps.servers` config is all you need server-side. The runtime
    // auto-applies the MCP Apps middleware to every registered agent: on each
    // MCP tool call it fetches the associated UI resource and emits an
    // `activity` event that the built-in `MCPAppsActivityRenderer` renders
    // inline in the chat.
    const runtime = new CopilotRuntime({
      agents: {
        "mcp-apps": mcpAppsAgent,
        "headless-complete": headlessCompleteAgent,
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
