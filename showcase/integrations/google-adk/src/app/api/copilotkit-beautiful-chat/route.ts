// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat simultaneously exercises A2UI (dynamic + fixed schema),
// Open Generative UI, and MCP Apps. The canonical reference
// (examples/integrations/langgraph-python) ships all three flags on a single
// runtime; this route mirrors that combined-runtime shape for the ADK
// integration so non-flagship cells keep their per-demo `useFrontendTool` /
// `useComponent` registrations isolated on the main `/api/copilotkit`
// endpoint.
//
// References:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts
// - src/app/api/copilotkit-ogui/route.ts (scoping pattern)
// - src/app/api/copilotkit-mcp-apps/route.ts (mcpApps config pattern)
// - src/app/api/copilotkit-declarative-gen-ui/route.ts (a2ui injectA2UITool: false pattern)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const beautifulChatAgent: AbstractAgent = new HttpAgent({
  url: `${AGENT_URL}/beautiful_chat`,
});

const agents: Record<string, AbstractAgent> = {
  // The page's <CopilotKit agent="beautiful-chat"> resolves here.
  "beautiful-chat": beautifulChatAgent,
  // Internal components (headless-chat, example-canvas) call `useAgent()`
  // with no args, which defaults to agentId "default". Alias to the same
  // agent so those component hooks resolve instead of throwing
  // "Agent 'default' not found". This matches the canonical's
  // `agents: { default: defaultAgent }` shape.
  default: beautifulChatAgent,
};

const runtime = new CopilotRuntime({
  // @ts-expect-error -- see main route.ts
  agents,
  // Canonical: openGenerativeUI: true, a2ui.injectA2UITool: false, mcpApps.
  openGenerativeUI: true,
  a2ui: {
    // The backend graph has its own `generate_a2ui` tool, so we must NOT
    // inject the runtime's default A2UI tool on top (that would double-bind
    // the tool slot and confuse the LLM).
    injectA2UITool: false,
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

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  endpoint: "/api/copilotkit-beautiful-chat",
  serviceAdapter: new ExperimentalEmptyAdapter(),
  runtime,
});

export const POST = async (req: NextRequest) => {
  try {
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
