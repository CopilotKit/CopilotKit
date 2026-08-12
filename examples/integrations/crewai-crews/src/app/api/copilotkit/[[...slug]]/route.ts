import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { CrewAIAgent } from "@ag-ui/crewai";
import { handle } from "hono/vercel";

type RuntimeOptions = ConstructorParameters<typeof CopilotRuntime>[0];
type StaticAgents = Extract<RuntimeOptions["agents"], Record<string, unknown>>;

// 1. Create the CopilotRuntime instance and utilize the CrewAI AG-UI
//    integration to setup the connection.
const runtime = new CopilotRuntime({
  agents: {
    default: new CrewAIAgent({
      url: process.env.AGENT_URL || "http://localhost:8000/",
    }),
  } as unknown as StaticAgents,
  // --- copilotkit:intelligence (remove this block to opt out) ---
  ...(process.env.COPILOTKIT_LICENSE_TOKEN
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.INTELLIGENCE_API_KEY ?? "",
          apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
          wsUrl:
            process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
        }),
        // Demo stub — replace with your own auth-derived user identity (e.g. OIDC)
        // before any multi-user deployment, or all users share one thread history.
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
        licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
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
