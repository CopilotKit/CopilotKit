import {
  CopilotRuntime,
  CopilotKitIntelligence,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { createDefaultAgent } from "@/agent";

// Strands-specific: the agent runs under uvicorn + ag_ui_strands, which
// speaks AG-UI directly. We talk to it via HttpAgent (not LangGraphAgent
// or LangGraphHttpAgent — those target LangGraph-shaped endpoints).
// Everything else — runtime config, endpoint wiring, MCP apps,
// openGenerativeUI — mirrors the canonical demo.
const defaultAgent = createDefaultAgent();

const runtime = new CopilotRuntime({
  agents: { default: defaultAgent },
  // --- copilotkit:intelligence (remove this block to opt out) ---
  ...(process.env.CPK_INTELLIGENCE_API_KEY
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.CPK_INTELLIGENCE_API_KEY,
          ...(process.env.INTELLIGENCE_API_URL
            ? { apiUrl: process.env.INTELLIGENCE_API_URL }
            : {}),
          ...(process.env.INTELLIGENCE_GATEWAY_WS_URL
            ? { wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL }
            : {}),
        }),
        // Demo stub — replace with your real auth-derived user identity before any
        // multi-user deployment, or all users share one thread history. The id
        // must correspond to a user that exists in CopilotKit Intelligence;
        // an unknown id (like this literal) can make thread operations fail.
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
  openGenerativeUI: true,
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com/mcp",
        serverId: "example_mcp_app",
      },
    ],
  },
});

const app = createCopilotRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = app;
export const POST = app;
export const PATCH = app;
export const DELETE = app;
