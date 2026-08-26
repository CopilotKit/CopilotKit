import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { HttpAgent } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";

const agent = new HttpAgent({
  url:
    process.env.AGENT_URL ||
    process.env.NEXT_PUBLIC_AGENT_URL ||
    "http://localhost:8000/",
});

agent.use(new A2UIMiddleware({ injectA2UITool: true }));

const runtime = new CopilotRuntime({
  agents: { my_a2ui_agent: agent },
  a2ui: {},
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
});

const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
