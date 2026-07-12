import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import type {
  AgentSubscriber,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { A2AMiddlewareAgent } from "@ag-ui/a2a-middleware";
import type { A2AAgentConfig } from "@ag-ui/a2a-middleware";
import { handle } from "hono/vercel";

const researchAgentUrl =
  process.env.RESEARCH_AGENT_URL || "http://localhost:9001";
const analysisAgentUrl =
  process.env.ANALYSIS_AGENT_URL || "http://localhost:9002";
const orchestratorUrl = process.env.ORCHESTRATOR_URL || "http://localhost:9000";

type RuntimeRunAgentInput = RunAgentParameters &
  Partial<Pick<RunAgentInput, "messages" | "state" | "threadId">>;

type RuntimeA2AMiddlewareAgentConfig = Omit<
  A2AAgentConfig,
  "orchestrationAgent"
> & {
  orchestrationAgentUrl: string;
};

class RuntimeA2AMiddlewareAgent extends A2AMiddlewareAgent {
  private readonly config: RuntimeA2AMiddlewareAgentConfig;

  constructor(config: RuntimeA2AMiddlewareAgentConfig) {
    super({
      ...config,
      orchestrationAgent: new HttpAgent({
        url: config.orchestrationAgentUrl,
      }),
    });
    this.config = config;
  }

  async runAgent(
    parameters: RuntimeRunAgentInput = {},
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const isolatedAgent = new A2AMiddlewareAgent({
      ...this.config,
      agentId: this.agentId,
      debug: this.debug,
      description: this.description,
      initialMessages: this.messages,
      initialState: this.state,
      threadId: parameters.threadId ?? this.threadId,
      orchestrationAgent: new HttpAgent({
        url: this.config.orchestrationAgentUrl,
      }),
    });

    if (parameters.state) {
      isolatedAgent.setState(parameters.state);
    }

    if (parameters.messages) {
      isolatedAgent.setMessages(parameters.messages);
    }

    return isolatedAgent.runAgent(
      {
        context: parameters.context,
        forwardedProps: parameters.forwardedProps,
        runId: parameters.runId,
        tools: parameters.tools,
      },
      subscriber,
    );
  }

  clone(): RuntimeA2AMiddlewareAgent {
    return new RuntimeA2AMiddlewareAgent({
      ...this.config,
      agentId: this.agentId,
      debug: this.debug,
      description: this.description,
      initialMessages: this.messages,
      initialState: this.state,
      threadId: this.threadId,
    });
  }
}

const a2aMiddlewareAgent = new RuntimeA2AMiddlewareAgent({
  orchestrationAgentUrl: orchestratorUrl,
  agentId: "a2a_chat",
  description:
    "Research assistant with 2 specialized agents: Research (LangGraph) and Analysis (ADK)",
  agentUrls: [researchAgentUrl, analysisAgentUrl],
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
  // --- copilotkit:intelligence (remove this block to opt out) ---
  intelligence: new CopilotKitIntelligence({
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY ?? "",
    apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
    wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
  }),
  // Demo stub - replace with your own auth-derived user identity (e.g. OIDC)
  // before any multi-user deployment, or all users share one thread history.
  identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
  // --- /copilotkit:intelligence ---
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
