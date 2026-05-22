import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { A2AMiddlewareAgent } from "@ag-ui/a2a-middleware";
import { handle } from "hono/vercel";

export async function POST(request: Request) {
  const researchAgentUrl =
    process.env.RESEARCH_AGENT_URL || "http://localhost:9001";
  const analysisAgentUrl =
    process.env.ANALYSIS_AGENT_URL || "http://localhost:9002";
  const orchestratorUrl =
    process.env.ORCHESTRATOR_URL || "http://localhost:9000";

  const orchestrationAgent = new HttpAgent({
    url: orchestratorUrl,
  });

  const a2aMiddlewareAgent = new A2AMiddlewareAgent({
    description:
      "Research assistant with 2 specialized agents: Research (LangGraph) and Analysis (ADK)",
    agentUrls: [researchAgentUrl, analysisAgentUrl],
    orchestrationAgent,
    instructions: `
      You are a research assistant that orchestrates between 2 specialized agents.

      AVAILABLE AGENTS:

      - Research Agent (LangGraph): Gathers and summarizes information about a topic
      - Analysis Agent (ADK): Analyzes research findings and provides insights

      WORKFLOW STRATEGY (SEQUENTIAL - ONE AT A TIME):

      When the user asks to research a topic:

      1. Research Agent - First, gather information about the topic
         - Pass: The user's research query or topic
         - The agent will return structured JSON with research findings

      2. Analysis Agent - Then, analyze the research results
         - Pass: The research results from step 1
         - The agent will return structured JSON with analysis and insights

      3. Present the complete research and analysis to the user

      CRITICAL RULES:
      - Call agents ONE AT A TIME, wait for results before making next call
      - Pass information from earlier agents to later agents
      - Synthesize all gathered information in final response
    `,
  });

  const runtime = new CopilotRuntime({
    agents: {
      a2a_chat: a2aMiddlewareAgent,
    },
    runner: new InMemoryAgentRunner(),
  });

  const app = createCopilotEndpoint({
    runtime,
    basePath: "/api/copilotkit",
  });

  return handle(app)(request);
}

export async function GET(request: Request) {
  const runtime = new CopilotRuntime({
    agents: {},
    runner: new InMemoryAgentRunner(),
  });
  const app = createCopilotEndpoint({
    runtime,
    basePath: "/api/copilotkit",
  });
  return handle(app)(request);
}
