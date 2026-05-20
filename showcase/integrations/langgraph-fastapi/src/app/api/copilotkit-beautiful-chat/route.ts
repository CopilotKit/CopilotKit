// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat simultaneously exercises A2UI (dynamic + fixed schema),
// Open Generative UI, and MCP Apps. The canonical reference
// (examples/integrations/langgraph-python) ships all three flags on a single
// runtime, but the 4085 showcase splits those concerns into per-feature
// endpoints so non-flagship cells keep their per-demo `useFrontendTool` /
// `useComponent` registrations isolated. This route restores the canonical's
// combined runtime for just the one cell that needs it.
//
// References:
// - examples/integrations/langgraph-python/src/app/api/copilotkit/[[...slug]]/route.ts
// - src/app/api/copilotkit-ogui/route.ts (scoping pattern)
// - src/app/api/copilotkit-mcp-apps/route.ts (mcpApps config pattern)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const beautifulChatAgent = new LangGraphAgent({
  deploymentUrl: LANGGRAPH_URL,
  graphId: "beautiful_chat",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const agents: Record<string, LangGraphAgent> = {
  // The page's <CopilotKit agent="beautiful-chat"> resolves here.
  "beautiful-chat": beautifulChatAgent,
  // Internal components (headless-chat, example-canvas) call `useAgent()`
  // with no args, which defaults to agentId "default". Alias to the same
  // graph so those component hooks resolve instead of throwing
  // "Agent 'default' not found". This matches the canonical's
  // `agents: { default: defaultAgent }` shape.
  default: beautifulChatAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
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
