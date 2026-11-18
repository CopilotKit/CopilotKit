import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const FIXED_AGENT_URL =
  process.env.FIXED_AGENT_URL ?? "http://localhost:8123/fixed";
const DYNAMIC_AGENT_URL =
  process.env.DYNAMIC_AGENT_URL ?? "http://localhost:8123/dynamic";

const fixedAgent = new HttpAgent({ url: FIXED_AGENT_URL });
const dynamicAgent = new HttpAgent({ url: DYNAMIC_AGENT_URL });

const runtime = new CopilotRuntime({
  agents: {
    // CopilotKit's client expects an agent named "default" for any hook
    // that doesn't pass an explicit agentId (e.g. our root provider mounted
    // on pages that don't render a chat). We alias it to the fixed wizard.
    default: fixedAgent,
    fixed_agent: fixedAgent,
    dynamic_agent: dynamicAgent,
  },
  // Both agents write A2UI v0.9: they return `a2ui_operations` in their tool
  // results. `a2uiVersion: "0.9"` makes the runtime convert those surfaces to
  // A2UI 1.0 generative UI surfaces for the browser, hand the agents the v0.9
  // component schema of the client's catalog as context, and turn a click
  // back into the v0.9 `forwardedProps.a2uiAction`. We deliberately set
  // `injectA2UITool: false` so the runtime does NOT register `render_a2ui`
  // as a frontend tool. instead, the dynamic agent has a Python
  // `generate_a2ui` tool that calls a secondary LLM and returns operations
  // as a normal tool result. This avoids the CopilotKitMiddleware
  // strip-and-restore lifecycle that leaves orphan tool_calls in agent
  // state (which was crashing turn 2 with INCOMPLETE_STREAM).
  generativeUI: {
    a2uiVersion: "0.9",
    injectA2UITool: false,
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

export { handler as POST };
