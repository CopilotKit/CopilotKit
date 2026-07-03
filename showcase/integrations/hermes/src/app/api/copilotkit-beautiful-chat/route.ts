// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat simultaneously exercises A2UI (dynamic `render_a2ui` +
// fixed-schema `search_flights` rendered through the same middleware-injected
// path), Open Generative UI (`generateSandboxedUi`), and MCP Apps (Excalidraw).
// The canonical reference (integrations/langgraph-python) ships all three flags
// on a single runtime; the other hermes cells split those concerns into
// per-feature endpoints so non-flagship cells keep their per-demo
// `useFrontendTool` / `useComponent` registrations isolated. This route
// restores the canonical's combined runtime for just the one cell that needs
// it, proxying to the hermes AG-UI adapter via `HttpAgent`.
//
// Hermes serves every run from a single AG-UI endpoint (POST /) on :8000, so
// the "beautiful-chat" agent name maps to the same HttpAgent at the root URL.
//
// References:
// - integrations/langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts
// - src/app/api/copilotkit-mcp-apps/route.ts (mcpApps config + HttpAgent proxy)
// - src/app/api/copilotkit-a2ui-fixed-schema/route.ts (middleware-injected
//   render_a2ui path — hermes can't emit agent-side tool RESULTs, so the
//   fixed-schema flight surface is emitted as render_a2ui, same as here)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { HermesAgent } from "@ag-ui/hermes";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HermesAgent({ url: `${AGENT_URL}/` });
}

const agents: Record<string, AbstractAgent> = {
  "beautiful-chat": createAgent(),
};

// Canonical combined runtime: openGenerativeUI + a2ui(injectA2UITool) + mcpApps.
const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  // Open Generative UI: the runtime middleware turns a `generateSandboxedUi`
  // tool call into open-generative-ui activity events the built-in renderer
  // mounts inside a sandboxed iframe.
  openGenerativeUI: true,
  a2ui: {
    // Inject the dynamic `render_a2ui` tool into the agent. Both the dynamic
    // Sales-Dashboard path and the fixed-schema flight path emit `render_a2ui`
    // (hermes has no A2UI backend and a generic aimock agent can't emit an
    // agent-side tool RESULT the middleware would detect).
    injectA2UITool: true,
    // Pin the catalog the page registers (`copilotkit://app-dashboard-catalog`)
    // so component names resolve even when the emitted args omit `catalogId`.
    defaultCatalogId: "copilotkit://app-dashboard-catalog",
  },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        // Stable serverId so persisted threads keep restoring the same MCP
        // server across URL changes.
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
