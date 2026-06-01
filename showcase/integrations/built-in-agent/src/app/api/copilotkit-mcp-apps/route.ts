import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createMcpAppsAgent } from "@/lib/factory/mcp-apps-factory";

// @region[runtime-mcpapps-config]
// Dedicated runtime for the MCP Apps demo.
//
// `mcpApps.servers` auto-applies the MCP Apps middleware to every registered
// agent: the middleware exposes the remote MCP server's tools to the agent at
// request time and emits the activity events that CopilotKit's built-in
// `MCPAppsActivityRenderer` renders inline as a sandboxed iframe.
const runtime = new CopilotRuntime({
  agents: { default: createMcpAppsAgent() },
  runner: new InMemoryAgentRunner(),
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        // Always pin a stable serverId — without it CopilotKit hashes the URL
        // and a URL change silently breaks restoration of persisted MCP apps.
        serverId: "excalidraw",
      },
    ],
  },
});
// @endregion[runtime-mcpapps-config]

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-mcp-apps",
  mode: "single-route",
});

async function withProbeCompat(req: Request): Promise<Response> {
  const res = await handler(req);
  if (res.status === 404) {
    const body = await res.text();
    return new Response(body, { status: 400, headers: res.headers });
  }
  return res;
}

export const GET = (req: Request) => handler(req);
export const POST = (req: Request) => withProbeCompat(req);
export const OPTIONS = (req: Request) => handler(req);
