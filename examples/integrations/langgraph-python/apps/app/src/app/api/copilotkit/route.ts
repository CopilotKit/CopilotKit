import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { extractCatalogSchema } from "@copilotkit/shared";
import { NextRequest } from "next/server";
import { demonstrationCatalogDefinitions } from "../../declarative-generative-ui/definitions";

const demonstrationSchema = extractCatalogSchema(demonstrationCatalogDefinitions);

const defaultAgent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    endpoint: "/api/copilotkit",
    serviceAdapter: new ExperimentalEmptyAdapter(),
    runtime: new CopilotRuntime({
      agents: { default: defaultAgent },
      a2ui: {
        injectA2UITool: true,
        schema: demonstrationSchema,
      },
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
};
