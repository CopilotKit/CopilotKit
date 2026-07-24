import {
  CopilotRuntime,
  CopilotKitIntelligence,
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

const intelligenceApiKey = process.env.CPK_INTELLIGENCE_API_KEY?.trim();

const runtime = new CopilotRuntime({
  licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
  agents: { default: defaultAgent },
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
  ...(intelligenceApiKey
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: intelligenceApiKey,
          apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
          wsUrl:
            process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
        }),
        // Demo stub — replace with auth-derived identity before multi-user use.
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
      }
    : { runner: new InMemoryAgentRunner() }),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
