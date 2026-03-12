import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { NextRequest } from "next/server";

const serviceAdapter = new ExperimentalEmptyAdapter();

export const POST = async (req: NextRequest) => {
  // Extract user-provided OpenAI API key from headers
  const userApiKey = req.headers.get("x-openai-api-key");

  // Create runtime with user API key passed through configurable
  const runtime = new CopilotRuntime({
    agents: {
      [process.env.LANGGRAPH_GRAPH_ID || "world_agent"]: new LangGraphAgent({
        deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8125",
        graphId: process.env.LANGGRAPH_GRAPH_ID || "world_agent",
        langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
        config: {
          configurable: {
            openai_api_key: userApiKey || undefined,
          },
        },
      }),
    },
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
