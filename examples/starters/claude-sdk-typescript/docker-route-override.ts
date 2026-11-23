/**
 * Docker-specific route override.
 * In Docker, the agent is served via AG-UI (not LangGraph Platform)
 * because langgraph-cli dev requires Docker-in-Docker.
 * The original route.ts (using LangGraphAgent) is preserved unchanged.
 */
import {
  CopilotKitRuntime,
  InMemoryAgentRunner,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const agentUrl = (process.env.AGENT_URL || "http://localhost:8123").replace(
  /\/+$/,
  "",
);

const defaultAgent = new HttpAgent({
  url: `${agentUrl}/`,
});

const runtime = new CopilotKitRuntime({
  agents: { default: defaultAgent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotKitRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = app;
export const POST = app;
