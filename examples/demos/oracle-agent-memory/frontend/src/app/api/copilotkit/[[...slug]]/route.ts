import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { HttpAgent } from "@ag-ui/client";

// Proxy to the Python Agent Spec agent (LangGraph) over AG-UI. The agent owns
// the LLM and the memory, so no service adapter / LLM key lives here.
const agent = new HttpAgent({
  url:
    process.env.AGENT_URL ||
    process.env.NEXT_PUBLIC_AGENT_URL ||
    "http://localhost:8000/run",
});

const runtime = new CopilotRuntime({
  agents: { oracle_concierge: agent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
