import {
  CopilotKitRuntime,
  CopilotKitIntelligence,
  InMemoryAgentRunner,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { CrewAIAgent } from "@ag-ui/crewai";

type RuntimeOptions = ConstructorParameters<typeof CopilotKitRuntime>[0];
type StaticAgents = Extract<RuntimeOptions["agents"], Record<string, unknown>>;

// 1. Create the CopilotRuntime instance and utilize the CrewAI AG-UI
//    integration to setup the connection.
const runtime = new CopilotKitRuntime({
  agents: {
    default: new CrewAIAgent({
      url: process.env.AGENT_URL || "http://localhost:8000/",
    }),
  } as unknown as StaticAgents,
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
});

// 2. Build a Hono app that handles the CopilotKit runtime requests.
const app = createCopilotKitRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = app;
export const POST = app;
export const PATCH = app;
export const DELETE = app;
