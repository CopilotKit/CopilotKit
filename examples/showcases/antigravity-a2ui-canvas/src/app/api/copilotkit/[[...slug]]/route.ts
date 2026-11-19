import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { AGENT_ID, createDefaultAgent } from "@/agent";
import { agentRouteHooks } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The runtime adds generative UI on its own: the page's provider sends the
// catalog and the "canvas" target with each run, and the runtime gives the
// agent a `render_ui` tool and a guide to the components. Nothing to set here.
const copilotRuntime = new CopilotRuntime({
  agents: { [AGENT_ID]: createDefaultAgent() },
  runner: new InMemoryAgentRunner(),
});

// The hooks cap request size and rate limit agent runs (src/lib/limits.ts).
const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
  hooks: agentRouteHooks(),
});

export const GET = handler;
export const POST = handler;
