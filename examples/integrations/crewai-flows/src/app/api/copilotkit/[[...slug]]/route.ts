import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

// 1. Create the CopilotRuntime instance and utilize the HttpAgent AG-UI
//    integration to setup the connection.
const intelligenceApiKey = process.env.CPK_INTELLIGENCE_API_KEY?.trim();

const runtime = new CopilotRuntime({
  agents: {
    default: new HttpAgent({
      url: (process.env.AGENT_URL || "http://localhost:8000").replace(
        /\/$/,
        "",
      ),
    }),
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

// 2. Build a Hono app that handles the CopilotKit runtime requests.
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
