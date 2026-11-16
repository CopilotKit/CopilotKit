/**
 * CopilotKit API route for A2UI agent.
 *
 * Uses @copilotkit/runtime for A2A compatibility.
 * The A2AAgent from @ag-ui/a2a works with the v2 runtime API.
 */

import {
  CopilotKitRuntime,
  createCopilotKitRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { A2AAgent } from "@ag-ui/a2a";
import { A2AClient } from "@a2a-js/sdk/client";

// Create A2A client connecting to Python server
const a2aClient = new A2AClient(
  process.env.A2A_AGENT_URL || "http://localhost:10002",
);

// A2AAgent handles A2UI extension negotiation with the Python server
const a2uiAgent = new A2AAgent({ a2aClient });

// Create CopilotKit runtime with A2UI agent as default
const runtime = new CopilotKitRuntime({
  agents: {
    default: a2uiAgent,
  },
  runner: new InMemoryAgentRunner(),
  // The A2A agent writes legacy A2UI surfaces and calls no tools: the runtime
  // converts v0.9 surfaces to A2UI 1.0 and sends clicks back in v0.9 form.
  generativeUI: { a2uiVersion: "0.9", injectA2UITool: false },
});

// Create Hono endpoint
const app = createCopilotKitRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit-a2ui",
});

export const GET = app;
export const POST = app;
