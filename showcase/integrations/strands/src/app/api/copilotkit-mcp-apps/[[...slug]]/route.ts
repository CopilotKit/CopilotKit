// CopilotKit runtime for the MCP Apps cell (Strands).
//
// The runtime's `mcpApps` config auto-applies the MCP Apps middleware to the
// agent: when the agent calls a tool backed by an MCP UI resource, the
// middleware fetches the resource and emits the activity event that the
// built-in `MCPAppsActivityRenderer` (registered by CopilotKit internally)
// renders in the chat as a sandboxed iframe.
//
// Catch-all `[[...slug]]` mirrors langgraph-python / ms-agent-python so MCP
// Apps resource proxy requests addressed below `/api/copilotkit-mcp-apps`
// resolve (a plain parent `route.ts` only handles the chat POST).
//
// Agent paths prepare B6 wire-server mounts:
//   - mcp-apps          → AGENT_URL/mcp-apps/
//   - headless-complete → AGENT_URL/headless-complete/ (MCP sketch path)
//
// Reference (LGP sibling):
// showcase/integrations/langgraph-python/src/app/api/copilotkit-mcp-apps/

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

const mcpAppsAgent = new HttpAgent({ url: `${AGENT_URL}/mcp-apps/` });
const headlessCompleteAgent = new HttpAgent({
  url: `${AGENT_URL}/headless-complete/`,
});

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
    "mcp-apps": mcpAppsAgent,
    // headless-complete shares this runtime (its page wires
    // runtimeUrl="/api/copilotkit-mcp-apps") because its cell also exercises
    // MCP Apps rendering (via a hand-rolled `useRenderActivityMessage`).
    "headless-complete": headlessCompleteAgent,
    default: mcpAppsAgent,
  },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        // Always pin a stable `serverId`. Without it CopilotKit hashes the
        // URL, and a URL change silently breaks restoration of persisted
        // MCP Apps in prior conversation threads. Match LGP / ms-agent.
        serverId: "excalidraw",
      },
    ],
  },
});
// @endregion[runtime-mcpapps-config]

export const POST = async (req: NextRequest) => {
  if (ROUTE_DEBUG) {
    console.log(`[copilotkit-mcp-apps/route] POST ${req.url}`);
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-mcp-apps",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(
        `[copilotkit-mcp-apps/route] Response status: ${response.status}`,
      );
    } else if (ROUTE_DEBUG) {
      console.log(
        `[copilotkit-mcp-apps/route] Response status: ${response.status}`,
      );
    }
    return response;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
