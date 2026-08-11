import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { NextRequest } from "next/server";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";

// 1. Define the agent middleware
const middlewares = [
  // 1.1. MCP Apps Middleware — connect the hosted Vest MCP server.
  //      Vest is a public, hosted streamable-HTTP MCP server, so there is no
  //      local server to spawn: just point the middleware at the endpoint.
  new MCPAppsMiddleware({
    mcpServers: [
      {
        type: "http",
        url: "https://mcp.getvest.ai/mcp",
        serverId: "vest", // Recommended: stable identifier
      },
    ],
  }),
  // 1.2. More middlewares can be added here
];

// 2. Create the agent. Vest exposes tools such as vest_search_tools,
//    vest_estimate_cashback and vest_build_stack — the agent can call them to
//    recommend SaaS tools and surface live cashback offers instead of guessing.
const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt:
    "You are an assistant that helps users pick AI/SaaS tools. " +
    "Use the Vest tools to search the catalog (vest_search_tools), " +
    "estimate cashback (vest_estimate_cashback) and build a stack " +
    "(vest_build_stack) instead of relying on training data.",
});

// 3. Apply the middleware to the agent
for (const middleware of middlewares) {
  agent.use(middleware);
}

// 4. Create the service adapter, empty if not relevant
const serviceAdapter = new ExperimentalEmptyAdapter();

// 5. Create the runtime
const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
});

// 6. Create the API route
export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
