/**
 * CopilotKit API route for A2UI agent.
 *
 * Uses @copilotkit/runtime/v2 for A2A compatibility.
 * The A2AAgent from @ag-ui/a2a works with the v2 runtime API.
 */

import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { A2AClient } from "@a2a-js/sdk/client";
import { RuntimeA2AAgent } from "../../runtime-a2a-agent";

// Create A2A client connecting to Python server
const a2aClient = new A2AClient(
  process.env.A2A_AGENT_URL || "http://localhost:10002",
);

// A2AAgent handles A2UI extension negotiation with the Python server
const a2uiAgent = new RuntimeA2AAgent({ a2aClient });

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
