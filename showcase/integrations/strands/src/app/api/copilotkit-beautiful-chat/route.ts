// Dedicated runtime for the Beautiful Chat flagship showcase cell (Strands).
//
// Beautiful Chat simultaneously exercises A2UI (dynamic + fixed schema),
// Open Generative UI, and MCP Apps. The main `/api/copilotkit` runtime keeps
// those global flags OFF so per-demo `useFrontendTool` / `useComponent`
// registrations in non-flagship cells stay isolated. This route restores the
// canonical combined runtime (see langgraph-python beautiful-chat) for the
// one cell that needs it.
//
// Backend: HttpAgent → AGENT_URL/beautiful-chat/ (B6 wire-server mounts the
// specialized agent; trailing slash so the FastAPI sub-app root resolves).
//
// References:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts
// - showcase/integrations/ms-agent-python/src/app/api/copilotkit-beautiful-chat/route.ts

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica. Set SHOWCASE_ROUTE_DEBUG=1 locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

// Single shared agent instance. Creating two independent HttpAgent objects
// (one for "beautiful-chat", one for "default") breaks the Task Manager pill:
// the chat drives "beautiful-chat" while example-canvas reads useAgent() →
// "default", so STATE_SNAPSHOT never reaches the canvas. Share one instance.
const beautifulChatAgent: AbstractAgent = new HttpAgent({
  // B6 registers the specialized agent at /beautiful-chat on agent_server.
  url: `${AGENT_URL}/beautiful-chat/`,
});

const agents: Record<string, AbstractAgent> = {
  // The page's <CopilotKit agent="beautiful-chat"> resolves here.
  "beautiful-chat": beautifulChatAgent,
  // Internal components (example-canvas) call `useAgent()` with no args,
  // which defaults to agentId "default". Alias to the SAME instance so
  // state pushed via the chat reaches the canvas.
  default: beautifulChatAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents,
  // Canonical LGP combined runtime: openGenerativeUI + a2ui + mcpApps.
  openGenerativeUI: true,
  a2ui: {
    // The Strands showcase agent owns `generate_a2ui` itself (see
    // build_showcase_agent in src/agents/agent.py; B6's beautiful-chat mount
    // reuses that tooling). The runtime must NOT inject a second copy —
    // that would double-bind the render tool. LGP sets injectA2UITool:true
    // because its graph relies on runtime injection; Strands backend-owns
    // the tool so this stays false (same as ms-agent-python / pydantic-ai).
    injectA2UITool: false,
    // Models follow the tool-usage guide and omit `catalogId`, and the
    // middleware then falls back to the unregistered spec basic catalog
    // ("Catalog not found" render error). Pin the catalog the page registers.
    defaultCatalogId: "copilotkit://app-dashboard-catalog",
  },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        // Stable serverId so persisted threads keep restoring the same MCP
        // server across URL changes. Matches LGP beautiful-chat.
        serverId: "beautiful_chat_mcp",
      },
    ],
  },
});

export const POST = async (req: NextRequest) => {
  if (ROUTE_DEBUG) {
    console.log(
      `[copilotkit-beautiful-chat/route] POST ${req.url} (content-type: ${req.headers.get("content-type")})`,
    );
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-beautiful-chat",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(
        `[copilotkit-beautiful-chat/route] Response status: ${response.status}`,
      );
    } else if (ROUTE_DEBUG) {
      console.log(
        `[copilotkit-beautiful-chat/route] Response status: ${response.status}`,
      );
    }
    return response;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(
      `[copilotkit-beautiful-chat/route] ERROR: ${e.message}`,
      e.stack,
    );
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
