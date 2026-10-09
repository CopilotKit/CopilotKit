// CopilotKit runtime for the MCP Apps cell — shared by two demos:
//   - headless-complete (cell exercises MCP Apps rendering via a hand-rolled
//     useRenderActivityMessage in use-rendered-messages.tsx)
//   - mcp-apps (relies on CopilotKit's built-in MCPAppsActivityRenderer)
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware to the
// agent: when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` (registered by CopilotKit internally)
// renders in the chat as a sandboxed iframe.
//
// Reference:
// https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const headlessCompleteAgent = new LangGraphAgent({
  deploymentUrl: `${LANGGRAPH_URL}/`,
  graphId: "headless_complete",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const mcpAppsAgent = new LangGraphAgent({
  deploymentUrl: `${LANGGRAPH_URL}/`,
  graphId: "mcp_apps",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

// @region[runtime-mcpapps-config]
// The `mcpApps.servers` config is all you need server-side. The runtime
// auto-applies the MCP Apps middleware to every registered agent: on each
// MCP tool call it fetches the associated UI resource and emits an
// `activity` event that the built-in `MCPAppsActivityRenderer` renders
// inline in the chat.
const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
  // MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in
  // source, pending release.
  agents: {
    "headless-complete": headlessCompleteAgent,
    "mcp-apps": mcpAppsAgent,
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
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-mcp-apps",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    // Log full error details server-side with a correlation id, but only
    // return the id (not the message or stack) to the client. Returning
    // raw `err.message` / `err.stack` over the wire leaks internals
    // (file paths, library versions, sometimes secrets in nested error
    // messages) to anyone who can hit /api/copilotkit-mcp-apps.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        route: "/api/copilotkit-mcp-apps",
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
