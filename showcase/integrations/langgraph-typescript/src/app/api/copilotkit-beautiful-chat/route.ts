// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat exercises A2UI (dynamic + fixed schema), Open Generative UI,
// and MCP Apps simultaneously — the same combined-runtime shape the canonical
// starter uses. The other langgraph-typescript cells share the default
// /api/copilotkit endpoint, so we split these flags off into their own route
// here to avoid bleeding them globally.
//
// Ported from langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const beautifulChatAgent = new LangGraphAgent({
  deploymentUrl: `${LANGGRAPH_URL}/`,
  graphId: "beautiful_chat",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const agents: Record<string, LangGraphAgent> = {
  // The page's <CopilotKit agent="beautiful-chat"> resolves here.
  "beautiful-chat": beautifulChatAgent,
  // Internal components (headless-chat, example-canvas) may call `useAgent()`
  // with no args, which defaults to "default". Alias to the same graph so
  // those component hooks resolve instead of throwing "Agent 'default' not
  // found".
  default: beautifulChatAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- matches main route.ts pattern
  agents,
  openGenerativeUI: true,
  a2ui: {
    // Inject the dynamic `generate_a2ui` tool into the agent
    injectA2UITool: true,
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
