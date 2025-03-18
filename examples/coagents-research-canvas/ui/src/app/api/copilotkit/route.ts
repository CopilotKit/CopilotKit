import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  langGraphPlatformEndpoint,
  copilotKitEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const llmAdapter = new OpenAIAdapter({ openai } as any);
const langsmithApiKey = process.env.LANGSMITH_API_KEY as string;

export const POST = async (req: NextRequest) => {
  const searchParams = req.nextUrl.searchParams;
  const deploymentUrl = searchParams.get("lgcDeploymentUrl");

  // If you are running the agent-js uncomment line 20-34 and comment out line 35-55

  //const runtime = new CopilotRuntime({
  // remoteEndpoints: [
  // Uncomment this if you want to use LangGraph JS, make sure to
  // remove the remote action url below too.
  //
  // langGraphPlatformEndpoint({
  //   deploymentUrl: "http://localhost:8123",
  //   langsmithApiKey: process.env.LANGSMITH_API_KEY || "", // only used in LangGraph Platform deployments
  //   agents: [{
  //       name: "research_agentt",
  //       description: "Research agent"
  //   }]
  // }),
  // ],
  //});

  const remoteLangGraphPlatformEndpoint = langGraphPlatformEndpoint({
    deploymentUrl: deploymentUrl || "",
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
  });
  const remoteEndpoints = deploymentUrl
    ? [
        langGraphPlatformEndpoint({
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
        }),
      ]
    : [
        {
          ...remoteLangGraphPlatformEndpoint,
          deploymentUrl: process.env.LGC_DEPLOYMENT_URL,
        },
        copilotKitEndpoint({
          url:
            process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
        }),
      ];

  const runtime = new CopilotRuntime({
    remoteEndpoints,
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: llmAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
