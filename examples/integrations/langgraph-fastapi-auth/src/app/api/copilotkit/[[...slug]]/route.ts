import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

// 1. Create the CopilotRuntime instance and utilize the LangGraph AG-UI
//    integration to setup the connection to the FastAPI agent server.
//    LangGraphHttpAgent forwards the CopilotKit `properties` (including
//    authorization) as `forwardedProps` to the LangGraph server, where they
//    are merged into config.configurable.
const runtime = new CopilotRuntime({
  agents: {
    agent_with_auth: new LangGraphHttpAgent({
      url:
        process.env.AGENT_URL ||
        process.env.LANGGRAPH_DEPLOYMENT_URL ||
        "http://localhost:8000",
    }),
  },
});

// 2. Build a fetch handler that serves the CopilotKit v2 runtime routes
//    (/info, /agent/:agentId/run, /agent/:agentId/connect, ...) under
//    /api/copilotkit. This file lives in a catch-all route so every sub-path
//    reaches the handler.
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
