import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  langGraphPlatformEndpoint,
  copilotKitEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";

const openai = new OpenAI();
const serviceAdapter = new OpenAIAdapter({ openai } as any);
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
            name: "joke_agent",
            description: "Make a joke.",
          },
          {
            name: "email_agent",
            description: "Write an email.",
          },
          {
            name: "pirate_agent",
            description: "Speak like a pirate.",
          },
        ],
      })
    : copilotKitEndpoint({
        url:
          process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
      });

  const runtime = new CopilotRuntime({
    remoteEndpoints: [remoteEndpoint],
    actions: [
      {
        name: "greetUser",
        description: "Greet the user",
        parameters: [
          {
            name: "name",
            type: "string",
            description: "The name of the user to greet",
          },
        ],
        handler: async ({ name }) => {
          console.log("greetUser", name);
          return "I greeted the user. YOU MUST tell the user to check the console to see the message.";
        },
      },
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
