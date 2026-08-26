import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createDefaultAgent } from "@/agent";
import { handle } from "hono/vercel";

const defaultAgent = createDefaultAgent();

const runtime = new CopilotRuntime({
  agents: { default: defaultAgent },
  // --- copilotkit:intelligence (remove this block to opt out) ---
  ...(process.env.COPILOTKIT_LICENSE_TOKEN
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.INTELLIGENCE_API_KEY ?? "",
          ...(process.env.INTELLIGENCE_API_URL
            ? { apiUrl: process.env.INTELLIGENCE_API_URL }
            : {}),
          ...(process.env.INTELLIGENCE_GATEWAY_WS_URL
            ? { wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL }
            : {}),
        }),
        // Threads are per-user, so until your app sends x-user-id every
        // visitor shares the "anonymous" history. Wire these headers to
        // your auth-derived identity before any multi-user deployment.
        identifyUser: (request) => ({
          id: request.headers.get("x-user-id") ?? "anonymous",
          name: request.headers.get("x-user-name") ?? "Anonymous",
        }),
        licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
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
export const PATCH = handle(app);
export const DELETE = handle(app);
