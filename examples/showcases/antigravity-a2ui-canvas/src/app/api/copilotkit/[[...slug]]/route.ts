import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { AGENT_ID, createDefaultAgent } from "@/agent";

// The runtime adds generative UI on its own: the page's provider sends the
// catalog and the "canvas" target with each run, and the runtime gives the
// agent a `render_ui` tool and a guide to the components. Nothing to set here.
const runtime = new CopilotRuntime({
  agents: { [AGENT_ID]: createDefaultAgent() },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
