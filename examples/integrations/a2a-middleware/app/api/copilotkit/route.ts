/**
 * CopilotKit API Route with A2A Middleware
 *
 * This connects the frontend to multiple agents using two protocols:
 * - AG-UI Protocol: Frontend ↔ Orchestrator (via CopilotKit)
 * - A2A Protocol: Orchestrator ↔ Specialized Agents (Research, Analysis)
 *
 * The A2A middleware injects send_message_to_a2a_agent tool into the orchestrator,
 * enabling seamless agent-to-agent communication without the orchestrator needing
 * to understand A2A Protocol directly.
 */

import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { A2AMiddlewareAgent } from "@ag-ui/a2a-middleware";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const researchAgentUrl = process.env.RESEARCH_AGENT_URL || "http://localhost:9001";
  const analysisAgentUrl = process.env.ANALYSIS_AGENT_URL || "http://localhost:9002";
  const orchestratorUrl = process.env.ORCHESTRATOR_URL || "http://localhost:9000";

  // Connect to orchestrator via AG-UI Protocol
  const orchestrationAgent = new HttpAgent({
    url: orchestratorUrl,
  });

  // A2A Middleware: Wraps orchestrator and injects send_message_to_a2a_agent tool
  // This allows orchestrator to communicate with A2A agents transparently
  const a2aMiddlewareAgent = new A2AMiddlewareAgent({
    description:
      "Research assistant with 2 specialized agents: Research (LangGraph) and Analysis (ADK)",
    agentUrls: [
      researchAgentUrl,
      analysisAgentUrl,
    ],
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

  // CopilotKit runtime connects frontend to agent system
  const runtime = new CopilotRuntime({
    agents: {
      a2a_chat: a2aMiddlewareAgent, // Must match agent prop in <CopilotKit agent="a2a_chat">
    },
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(request);
}
