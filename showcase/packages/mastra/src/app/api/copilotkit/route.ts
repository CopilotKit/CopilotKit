import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { MastraAgent } from "@ag-ui/mastra";
import { NextRequest } from "next/server";
import { mastra } from "@/mastra";

// 1. You can use any service adapter here for multi-agent support.
const serviceAdapter = new ExperimentalEmptyAdapter();

// The Mastra config registers a single local agent (`weatherAgent`), but the
// demo pages request a variety of agent names (`agentic_chat`,
// `human_in_the_loop`, etc.). Mirror the crewai-crews pattern and expose the
// same underlying agent under every name the demos ask for so the runtime can
// resolve them. `weatherAgent` is also preserved for backend smoke tests.
const demoAgentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
];

function buildAgents() {
  // @ts-expect-error - ignore for now, typing error (matches upstream pattern)
  const localAgents = MastraAgent.getLocalAgents({ mastra }) as Record<
    string,
    unknown
  >;
  const weatherAgent = localAgents.weatherAgent;
  const agents: Record<string, unknown> = { ...localAgents };
  if (weatherAgent) {
    for (const name of demoAgentNames) {
      agents[name] = weatherAgent;
    }
  }
  return agents;
}

// 2. Build a Next.js API route that handles the CopilotKit runtime requests.
export const POST = async (req: NextRequest) => {
  // 3. Create the CopilotRuntime instance and utilize the Mastra AG-UI
  //    integration to get the remote agents. Cache this for performance.
  const runtime = new CopilotRuntime({
    // @ts-expect-error - ignore for now, typing error
    agents: buildAgents(),
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
