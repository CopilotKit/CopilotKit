// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat exercises A2UI, Open Generative UI, and MCP Apps on a
// single Built-in Agent runtime.

import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createAgentAliases } from "@/lib/factory/agent-aliases";
import { createBuiltInAgent } from "@/lib/factory/tanstack-factory";
import { withForwardedHeaders } from "@/lib/header-forwarding";

const BEAUTIFUL_CHAT_AGENT_IDS = ["beautiful-chat"] as const;
const createBeautifulChatAgent = () =>
  createBuiltInAgent({ toolProfile: "beautiful-chat" });

// @region[beautiful-chat-runtime-config]
const runtime = new CopilotRuntime({
  agents: createAgentAliases(BEAUTIFUL_CHAT_AGENT_IDS, createBeautifulChatAgent),
  runner: new InMemoryAgentRunner(),
  openGenerativeUI: {
    agents: [...BEAUTIFUL_CHAT_AGENT_IDS],
  },
  a2ui: {
    injectA2UITool: true,
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
// @endregion[beautiful-chat-runtime-config]

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-beautiful-chat",
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
