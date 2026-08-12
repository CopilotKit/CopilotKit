import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createMcpAppsAgent } from "@/lib/factory/mcp-apps-factory";
import { createBuiltInAgent } from "@/lib/factory/tanstack-factory";
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";

// @region[runtime-mcpapps-config]
// Dedicated runtime for the MCP Apps demo.
//
// `mcpApps.servers` auto-applies the MCP Apps middleware to every registered
// agent: the middleware exposes the remote MCP server's tools to the agent at
// request time and emits the activity events that CopilotKit's built-in
// `MCPAppsActivityRenderer` renders inline as a sandboxed iframe.
const runtime = new CopilotRuntime({
  agents: {
    "mcp-apps": createMcpAppsAgent(),
    // headless-complete shares this runtime because its cell also exercises
    // MCP Apps rendering (via a hand-rolled useRenderActivityMessage in
    // use-rendered-messages.tsx). Mirrors the LGP reference route.
    "headless-complete": createBuiltInAgent(),
  },
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

export const GET = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
export const POST = (req: Request) =>
  withForwardedHeaders(req, () => withProbeCompat(req));
export const OPTIONS = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
