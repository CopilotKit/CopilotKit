import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint, langGraphCloudEndpoint, copilotKitEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";

const openai = new OpenAI();
const serviceAdapter = new OpenAIAdapter({ openai } as any);
const langsmithApiKey = process.env.LANGSMITH_API_KEY as string

export const POST = async (req: NextRequest) => {
  const searchParams = req.nextUrl.searchParams
  const deploymentUrl = searchParams.get('lgcDeploymentUrl')

  const remoteEndpoint = deploymentUrl ? langGraphCloudEndpoint({
    deploymentUrl,
    langsmithApiKey,
    agents: [
      {
        name: "research_agent",
        description: "Research agent",
      },
      {
        name: "research_agent_google_genai",
        description: "Research agent",
        assistantId: "9dc0ca3b-1aa6-547d-93f0-e21597d2011c",
      },
    ],
  }) : copilotKitEndpoint({
    url: process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
  })

  const runtime = new CopilotRuntime({
    remoteActions: [remoteEndpoint],
    actions: [
      {
        name: "sayGoodbye",
        description: "Say goodbye to the user",
        parameters: [
          {
            name: "name",
            type: "string",
            description: "The name of the user to say goodbye to",
          },
        ],
        handler: async ({ name }) => {
          console.log("goodbye", name);
          return "I said goodbye to the user. YOU MUST tell the user to check the console to see the message.";
        },
      },
    ],
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
