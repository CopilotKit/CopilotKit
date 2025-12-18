import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  copilotKitEndpoint,
    EmptyAdapter,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent, LangGraphAgent } from '@copilotkit/runtime/langgraph'
import { NextRequest } from "next/server";
import { CrewAIAgent } from "@ag-ui/crewai";

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// const llmAdapter = new OpenAIAdapter({ openai } as any);
const llmAdapter = new EmptyAdapter()
const langsmithApiKey = process.env.LANGSMITH_API_KEY as string;

export const POST = async (req: NextRequest) => {
  const searchParams = req.nextUrl.searchParams;
  const deploymentUrl =
    searchParams.get("lgcDeploymentUrl") || process.env.LGC_DEPLOYMENT_URL;

  const isCrewAi = searchParams.get("coAgentsModel") === "crewai";

  const baseUrl = process.env.REMOTE_ACTION_URL || "http://localhost:8000";

  const runtime = new CopilotRuntime({
      agents: {
          'research_agent_lgp': new LangGraphAgent({
              deploymentUrl: deploymentUrl ?? '',
              langsmithApiKey,
              graphId: 'research_agent_lgp',
          }),
          'research_agent_google_genai_lgp': new LangGraphAgent({
              deploymentUrl: deploymentUrl ?? '',
              langsmithApiKey,
              graphId: 'research_agent_google_genai_lgp',
          }),
          'research_agent': new LangGraphHttpAgent({
              url: `${baseUrl}/agents/research_agent`,
          }),
          'research_agent_google_genai': new LangGraphHttpAgent({
              url: `${baseUrl}/agents/research_agent_google_genai`,
          }),
          'research_agent_crewai': new CrewAIAgent({
              url: `${baseUrl}/agents/research_agent_crewai`,
          }),
      }
  })

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: llmAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
