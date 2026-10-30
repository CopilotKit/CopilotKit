// Bring your own agent: a Google ADK agent (examples/adk) served over AG-UI.
// The agent has no A2UI code. Because the provider on /adk passes
// `generativeUI={{ ui }}`, every run carries the catalog, and the runtime's
// generative UI middleware adds the `render_ui` tool and its guide to the
// request it forwards to the agent. It then validates each A2UI v1.0 operation
// the agent streams back and sends it to the browser.
import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { agentRouteHooks } from "@/lib/limits";

const copilotRuntime = new CopilotRuntime({
  agents: {
    default: new HttpAgent({
      url: process.env.ADK_AGENT_URL ?? "http://localhost:8000/",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/adk",
  hooks: agentRouteHooks(),
});
export const GET = handler;
export const POST = handler;
