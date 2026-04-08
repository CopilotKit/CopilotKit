import { serve } from "@hono/node-server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const agent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
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
});

const handler = copilotRuntimeNodeHttpEndpoint({
  runtime,
  serviceAdapter: new ExperimentalEmptyAdapter(),
  endpoint: "/api/copilotkit",
});

const port = Number(process.env.PORT) || 4000;

serve({ fetch: handler as (req: Request) => Promise<Response>, port }, () => {
  console.log(`BFF ready at http://localhost:${port}`);
});
