import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
  ExperimentalEmptyAdapter,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@ag-ui/langgraph";

const serviceAdapter = new ExperimentalEmptyAdapter();

const agentName = process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME;
if (!agentName) {
  throw new Error(
    "Missing env NEXT_PUBLIC_COPILOTKIT_AGENT_NAME – required for LangGraph agent registration"
  );
}

if (!process.env.LANGGRAPH_DEPLOYMENT_URL) {
  throw new Error(
      "Missing env LANGGRAPH_DEPLOYMENT_URL – required for to know where to read the LangGraph agent from"
  );
}

const runtime = new CopilotRuntime({
  agents: {
    [agentName]: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL,
      langsmithApiKey: process.env.LANGSMITH_API_KEY || "", // only used in LangGraph Platform deployments
      graphId: agentName
    })
  }
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
