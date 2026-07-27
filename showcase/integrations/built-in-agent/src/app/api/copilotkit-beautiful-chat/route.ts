import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createBeautifulChatAgent } from "@/lib/factory/beautiful-chat-factory";
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";

// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat simultaneously exercises A2UI (dynamic + fixed schema), Open
// Generative UI, and MCP Apps. The canonical starter
// (examples/integrations/langgraph-python) ships all three flags on a single
// runtime; this restores that combined runtime for the one cell that needs it,
// backed by the built-in (TanStack) `beautiful_chat` port.
//
// The three middleware flags each inject tools into the agent's `input.tools`
// at request time — the beautiful-chat factory declares those injected tools
// so the model can call them:
//   - `openGenerativeUI: true`  → injects `generateSandboxedUi`
//   - `a2ui.injectA2UITool: true` → injects the dynamic `render_a2ui` tool
//     (the middleware's default injected tool name) plus its usage guidelines
//     and serialises the registered catalog into the agent context
//   - `mcpApps.servers` (Excalidraw) → injects the remote MCP tools (create_view, …)
const runtime = new CopilotRuntime({
  agents: { "beautiful-chat": createBeautifulChatAgent() },
  runner: new InMemoryAgentRunner(),
  openGenerativeUI: true,
  a2ui: {
    // Inject the dynamic A2UI render tool (`render_a2ui`) into the agent.
    injectA2UITool: true,
    // Models follow the tool-usage guide and omit `catalogId`; the middleware
    // then falls back to the unregistered spec basic catalog ("Catalog not
    // found" render error). Pin the catalog the page registers.
    defaultCatalogId: "copilotkit://app-dashboard-catalog",
  },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        // Stable serverId so persisted threads keep restoring the same MCP
        // server across URL changes.
        serverId: "beautiful_chat_mcp",
      },
    ],
  },
});

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
