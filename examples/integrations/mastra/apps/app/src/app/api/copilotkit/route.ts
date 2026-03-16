import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { MastraAgent } from "@ag-ui/mastra";
import { MastraClient } from "@mastra/client-js";
import { NextRequest } from "next/server";

const mastraClient = new MastraClient({
  baseUrl: process.env.MASTRA_URL || "http://localhost:4111",
});

export async function POST(req: NextRequest) {
  let agents;
  try {
    agents = await MastraAgent.getRemoteAgents({
      mastraClient,
      resourceId: "default",
    });
  } catch (error) {
    const mastraUrl = process.env.MASTRA_URL || "http://localhost:4111";
    console.error(`Failed to connect to Mastra server at ${mastraUrl}:`, error);
    return new Response(
      JSON.stringify({
        error: `Unable to reach Mastra agent server at ${mastraUrl}. Ensure the agent is running (cd apps/agent && pnpm dev).`,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    endpoint: "/api/copilotkit",
    serviceAdapter: new ExperimentalEmptyAdapter(),
    runtime: new CopilotRuntime({
      agents,
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
