import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest } from "next/server";

// 1. You can use any service adapter here for multi-agent support. We use
//    the empty adapter since we're only using one agent.
const serviceAdapter = new ExperimentalEmptyAdapter();

function getLangGraphDeploymentUrl() {
  if (process.env.LANGGRAPH_DEPLOYMENT_URL) {
    return process.env.LANGGRAPH_DEPLOYMENT_URL;
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:8123";
  }

  throw new Error(
    "LANGGRAPH_DEPLOYMENT_URL is required for the Cloudplot frontend service.",
  );
}

// The self-hosted FastAPI service speaks AG-UI directly.
const runtime = new CopilotRuntime({
  agents: {
    cloudplot_agent: new LangGraphHttpAgent({
      url: `${getLangGraphDeploymentUrl().replace(/\/$/, "")}/`,
    }),
  },
});

// 3. Build a Next.js API route that handles the CopilotKit runtime requests.
export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
