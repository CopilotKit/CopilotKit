import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint, langGraphPlatformEndpoint, copilotKitEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";

const openai = new OpenAI();
const llmAdapter = new OpenAIAdapter({ openai } as any);
const langsmithApiKey = process.env.LANGSMITH_API_KEY as string

export const POST = async (req: NextRequest) => {
  const searchParams = req.nextUrl.searchParams
  const deploymentUrl = searchParams.get('lgcDeploymentUrl')

  const remoteEndpoint = deploymentUrl ? langGraphPlatformEndpoint({
    deploymentUrl,
    langsmithApiKey,
    agents: [{
      name: 'greeting_agent',
      description: 'This agent greets the user',
    }],
  }) : copilotKitEndpoint({
    url: process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
  })

  const runtime = new CopilotRuntime({
    remoteEndpoints: [remoteEndpoint],
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: llmAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
