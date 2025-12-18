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
} from "@copilotkit/runtime/langgraph"
import OpenAI from "openai";

const openai = new OpenAI();
const llmAdapter = new OpenAIAdapter({ openai } as any);
const langsmithApiKey = process.env.LANGSMITH_API_KEY as string;

export const POST = async (req: NextRequest) => {
  const searchParams = req.nextUrl.searchParams;
  const deploymentUrl = searchParams.get("lgcDeploymentUrl");

  const remoteEndpoint = deploymentUrl
    ? langGraphPlatformEndpoint({
        deploymentUrl,
        langsmithApiKey,
        agents: [
          {
            name: "travel",
            description:
              "This agent helps the user plan and manage their trips",
          },
        ],
      })
    : copilotKitEndpoint({
        url:
          process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
      });

  const agents = {
      travel: deploymentUrl ? new LangGraphAgent({
          deploymentUrl,
          langsmithApiKey,
          graphId: 'travel'
      }) : new LangGraphHttpAgent({
          url: process.env.REMOTE_ACTION_URL || "http://localhost:8000",
      })
  }

  const runtime = new CopilotRuntime({
      agents
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: llmAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
