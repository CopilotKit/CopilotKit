import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";
import { langGraphCloudEndpoint } from "@copilotkit/runtime";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const serviceAdapter = new OpenAIAdapter({ openai } as any);

const deploymentUrl = process.env.LGC_DEPLOYMENT_URL as string
const langsmithApiKey = process.env.LANGSMITH_API_KEY as string

const runtime = new CopilotRuntime({
  remoteEndpoints: [
    langGraphCloudEndpoint({
      deploymentUrl,
      langsmithApiKey,
      agents: [
        {
          name: 'joke_agent',
          description: 'Make a joke.',
        },{
          name: 'email_agent',
          description: 'Write an email.',
        },{
          name: 'pirate_agent',
          description: 'Speak like a pirate.',
        },
      ],
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
