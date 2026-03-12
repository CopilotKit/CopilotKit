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
  // 1.1. MCP Apps Middleware
  new MCPAppsMiddleware({
    mcpServers: [
      {
        type: "http",
        url: "http://localhost:3108/mcp",
        serverId: "threejs" // Recommended: stable identifier
      },
    ],
  }),
  // 1.2. More middlewares can be added here
]

// 2. Create the agent
const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful assistant.",
})

// 3. Apply the middleware to the agent
for (const middleware of middlewares) {
  agent.use(middleware)
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
