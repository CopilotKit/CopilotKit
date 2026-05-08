import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

// Strands-specific: the agent runs under uvicorn + ag_ui_strands, which
// speaks AG-UI directly. We talk to it via HttpAgent (not LangGraphAgent
// or LangGraphHttpAgent — those target LangGraph-shaped endpoints).
// Everything else — runtime config, v2 endpoint wiring, MCP apps,
// openGenerativeUI, a2ui — mirrors the canonical demo.
const defaultAgent = new HttpAgent({
  url: `${process.env.AGENT_URL || process.env.STRANDS_AGENT_URL || "http://localhost:8000"}/`,
});

const runtime = new CopilotRuntime({
  agents: { default: defaultAgent },
  runner: new InMemoryAgentRunner(),
  openGenerativeUI: true,
  a2ui: {
    injectA2UITool: false,
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
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);