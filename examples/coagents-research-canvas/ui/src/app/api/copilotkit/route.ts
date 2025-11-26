import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  copilotKitEndpoint,
  LangGraphAgent,
  LangGraphHttpAgent,
    EmptyAdapter,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// const llmAdapter = new OpenAIAdapter({ openai } as any);
const llmAdapter = new EmptyAdapter()
const langsmithApiKey = process.env.LANGSMITH_API_KEY as string;

export const POST = async (req: NextRequest) => {
  const searchParams = req.nextUrl.searchParams;
  const deploymentUrl =
    searchParams.get("lgcDeploymentUrl") || process.env.LGC_DEPLOYMENT_URL;

  const isCrewAi = searchParams.get("coAgentsModel") === "crewai";

  const baseUrl = process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit";
  let runtime = new CopilotRuntime({
    agents: {
      'research_agent': new LangGraphHttpAgent({
        url: `${baseUrl}/agents/research_agent`,
      }),
      'research_agent_google_genai': new LangGraphHttpAgent({
        url: `${baseUrl}/agents/research_agent_google_genai`,
      })
    }
  })

  if (isCrewAi) {
    runtime = new CopilotRuntime({
      remoteEndpoints: [
        copilotKitEndpoint({
          url: process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
        })
      ]
    })
  }

  if (deploymentUrl && !isCrewAi) {
    runtime = new CopilotRuntime({
      agents: {
        'research_agent': new LangGraphAgent({
          deploymentUrl,
          langsmithApiKey,
          graphId: 'research_agent',
        }),
        'research_agent_google_genai': new LangGraphAgent({
          deploymentUrl,
          langsmithApiKey,
          graphId: 'research_agent_google_genai',
        })
      }
    })
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: llmAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
