import {
  CopilotRuntime,
  CopilotKitIntelligence,
  InMemoryAgentRunner,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

// 1. Create the CopilotRuntime instance and utilize the Microsoft Agent Framework
//    AG-UI integration to set up the connection.
const runtime = new CopilotRuntime({
  agents: {
    // Our FastAPI endpoint URL
    default: new HttpAgent({
      url: process.env.AGENT_URL || "http://localhost:8000/",
    }),
  },
  // --- copilotkit:intelligence (remove this block to opt out) ---
  ...(process.env.COPILOTKIT_LICENSE_TOKEN
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.INTELLIGENCE_API_KEY ?? "",
          apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
          wsUrl:
            process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
        }),
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
        licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
});

// 2. Build a Next.js API route that handles the CopilotKit runtime requests.
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
