import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";
import { langGraphCloudEndpoint } from "@copilotkit/runtime";

const openai = new OpenAI();
const serviceAdapter = new OpenAIAdapter({ openai } as any);

const deploymentUrl = process.env.LGC_DEPLOYMENT_URL as string
const langsmithApiKey = process.env.LANGSMITH_API_KEY as string

const runtime = new CopilotRuntime({
  remoteEndpoints: [
    langGraphCloudEndpoint({
      deploymentUrl,
      langsmithApiKey,
      agents: [{
        name: 'greeting_agent',
        description: 'This agent greets the user',
      }],
    }),
  ],
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit-lgc",
  });

  return handleRequest(req);
};
