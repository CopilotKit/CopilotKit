import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest } from "next/server";

const defaultAgent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

export async function POST(req: NextRequest) {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    endpoint: "/api/copilotkit",
    serviceAdapter: new ExperimentalEmptyAdapter(),
    runtime: new CopilotRuntime({
      agents: { default: defaultAgent },
      a2ui: { injectA2UITool: true },
      mcpApps: {
        servers: [
          {
            type: "http",
            url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
            serverId: "example_mcp_app",
          },
        ],
      },
    }),
  });

  return handleRequest(req);
}
