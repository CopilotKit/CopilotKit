import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

const runtime = new CopilotRuntime({
  agents: {
    default: new HttpAgent({
      url: process.env.AGENT_URL || "http://localhost:8000/",
    }),
  },
  // --- copilotkit:intelligence (remove this block to opt out) ---
  intelligence: new CopilotKitIntelligence({
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY ?? "",
    apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
    wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
  }),
  // Demo stub — replace with your real auth-derived user identity before any
  // multi-user deployment, or all users share one thread history.
  identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
  // --- /copilotkit:intelligence ---
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
