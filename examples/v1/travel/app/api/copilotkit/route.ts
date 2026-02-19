import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  langGraphPlatformEndpoint,
  copilotKitEndpoint,
} from "@copilotkit/runtime";
import {
  LangGraphAgent,
  LangGraphHttpAgent,
} from "@copilotkit/runtime/langgraph";
import OpenAI from "openai";

const openai = new OpenAI();
const llmAdapter = new OpenAIAdapter({ openai } as any);

export const POST = async (req: NextRequest) => {
  const langsmithApiKey = process.env.LANGSMITH_API_KEY || "";
  const deploymentUrl = process.env.LANGGRAPH_DEPLOYMENT_URL || "";

  const travel = deploymentUrl
    ? new LangGraphAgent({
        deploymentUrl,
        langsmithApiKey,
        graphId: "travel",
      })
    : new LangGraphHttpAgent({
        url:
          process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
      });

  const runtime = new CopilotRuntime({
    agents: { travel },
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: llmAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
