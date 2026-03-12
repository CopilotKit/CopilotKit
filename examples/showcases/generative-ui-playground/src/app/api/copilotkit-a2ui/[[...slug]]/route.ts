/**
 * CopilotKit API route for A2UI agent.
 *
 * Uses @copilotkitnext/runtime for A2A compatibility.
 * The A2AAgent from @ag-ui/a2a works with the v2 runtime API.
 */

import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkitnext/runtime";
import { handle } from "hono/vercel";
import { A2AAgent } from "@ag-ui/a2a";
import { A2AClient } from "@a2a-js/sdk/client";

// Create A2A client connecting to Python server
const a2aClient = new A2AClient(process.env.A2A_AGENT_URL || "http://localhost:10002");

// A2AAgent handles A2UI extension negotiation with the Python server
const a2uiAgent = new A2AAgent({ a2aClient });

// Create CopilotKit runtime with A2UI agent as default
const runtime = new CopilotRuntime({
  agents: {
    default: a2uiAgent,
  },
  runner: new InMemoryAgentRunner(),
});

// Create Hono endpoint
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit-a2ui",
});

export const GET = handle(app);
export const POST = handle(app);
