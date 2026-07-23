// CopilotKit runtime for the MCP Apps cell.
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware to the
// agent: when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` (registered by CopilotKit internally)
// renders in the chat as a sandboxed iframe.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { withForwardedHeaders } from "@/mastra/_header_forwarding";

const mcpAppsAgent = getLocalAgent({
  mastra,
  agentId: "mcpAppsAgent",
  resourceId: "mastra-mcp-apps",
});
if (!mcpAppsAgent) {
  throw new Error("getLocalAgent returned null for mcpAppsAgent");
}

// headless-complete shares this runtime (its page wires
// runtimeUrl="/api/copilotkit-mcp-apps") but is backed by the dedicated
// headlessCompleteAgent — the same Mastra agent + resourceId the main
// route registers it against.
const headlessCompleteAgent = getLocalAgent({
  mastra,
  agentId: "headlessCompleteAgent",
  resourceId: "mastra-headlessCompleteAgent",
});
if (!headlessCompleteAgent) {
  throw new Error("getLocalAgent returned null for headlessCompleteAgent");
}

// @region[runtime-mcpapps-config]
// The `mcpApps.servers` config is all you need server-side. The runtime
// auto-applies the MCP Apps middleware to every registered agent: on each
// MCP tool call it fetches the associated UI resource and emits an
// `activity` event that the built-in `MCPAppsActivityRenderer` renders
// inline in the chat.
const runtime = new CopilotRuntime({
  // @ts-expect-error -- see main route.ts; published CopilotRuntime's `agents`
  // type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects
  // plain Records. Fixed in source, pending release.
  agents: {
    "headless-complete": headlessCompleteAgent,
    "mcp-apps": mcpAppsAgent,
    default: mcpAppsAgent,
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

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
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
  });
