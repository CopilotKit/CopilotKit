import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
  ExperimentalEmptyAdapter,
  LangGraphAgent,
} from "@copilotkit/runtime";

const serviceAdapter = new ExperimentalEmptyAdapter();

const agentName = process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME ?? ''

const runtime = new CopilotRuntime({
  agents: {
    [agentName]: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL || "",
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
