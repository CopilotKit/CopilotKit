/**
 * Docker-specific route override.
 * In Docker, the agent is served via AG-UI (not LangGraph Platform)
 * because langgraph-cli dev requires Docker-in-Docker.
 * The original route.ts (using LangGraphAgent) is preserved unchanged.
 */
import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

const agentUrl = process.env.AGENT_URL || "http://localhost:8123";

const defaultAgent = new HttpAgent({
  url: `${agentUrl}/`,
});

const runtime = new CopilotRuntime({
  agents: { default: defaultAgent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
