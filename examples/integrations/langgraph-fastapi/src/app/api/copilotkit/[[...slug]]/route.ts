import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

// FastAPI-specific: the agent runs under uvicorn + ag-ui-langgraph, which
// speaks AG-UI directly. We talk to it via HttpAgent, not LangGraphAgent
// (LangGraphAgent targets the LangGraph Platform / langgraph-cli dev
// surface, which is a different protocol). Everything else — runtime
// config, v2 endpoint wiring, MCP apps, openGenerativeUI, a2ui — mirrors
// the reference demo.
const defaultAgent = new LangGraphHttpAgent({
  url: `${process.env.AGENT_URL || "http://localhost:8123"}/`,
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
