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
//
// NOTE: This aliasing makes demo pages load without agent-name 404s.
// Demos that depend on specific agent capabilities (HITL interrupts,
// streaming state, gen-ui steps) remain limited by weatherAgent's features.
// Full feature parity requires dedicated Mastra agents per demo — see
// crewai-crews for the precedent pattern.
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
  // resourceId is typed as required. We pass "" because these demo agents are
  // stateless — scoping memory to an empty resource bucket is acceptable here.
  // This is a behavioral change from the pre-aliasing code which omitted the
  // field entirely; not a no-op.
  const localAgents = MastraAgent.getLocalAgents({ mastra, resourceId: "" });
  const weatherAgent = localAgents.weatherAgent;
  if (!weatherAgent) {
    throw new Error(
      "weatherAgent missing from Mastra config — required for demo aliases",
    );
  }
  return {
    ...localAgents,
    ...Object.fromEntries(demoAgentNames.map((name) => [name, weatherAgent])),
  };
}

// 2. Build a Next.js API route that handles the CopilotKit runtime requests.
export const POST = async (req: NextRequest) => {
  // 3. Create the CopilotRuntime instance and utilize the Mastra AG-UI
  //    integration to get the remote agents. Cache this for performance.
  const runtime = new CopilotRuntime({
    agents: buildAgents(),
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
