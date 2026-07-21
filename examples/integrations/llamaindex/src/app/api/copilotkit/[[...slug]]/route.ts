import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { LlamaIndexAgent } from "@ag-ui/llamaindex";
import { handle } from "hono/vercel";

const runtime = new CopilotRuntime({
  agents: {
    default: new LlamaIndexAgent({
      url:
        (process.env.AGENT_URL || "http://127.0.0.1:9000").replace(/\/$/, "") +
        "/run",
    }),
  },
  // --- copilotkit:intelligence (remove this block to opt out) ---
  intelligence: new CopilotKitIntelligence({
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY ?? "",
    apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
    wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
  }),
  // Demo stub — replace with your own auth-derived user identity (e.g. OIDC)
  // before any multi-user deployment, or all users share one thread history.
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
