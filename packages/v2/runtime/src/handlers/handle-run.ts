import {
  AbstractAgent,
  RunAgentInput,
  RunAgentInputSchema,
} from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import {
  CopilotRuntimeLike,
  CopilotIntelligenceRuntimeLike,
  isIntelligenceRuntime,
} from "../core/runtime";
import { extractForwardableHeaders } from "./header-utils";
import { handleIntelligenceRun } from "./intelligence/run";
import { handleSseRun } from "./sse/run";

interface RunAgentParameters {
  request: Request;
  runtime: CopilotRuntimeLike;
  agentId: string;
}

export async function handleRunAgent({
  runtime,
  request,
  agentId,
}: RunAgentParameters): Promise<Response> {
  try {
    const agents = await runtime.agents;

    if (!agents[agentId]) {
      return new Response(
        JSON.stringify({
          error: "Agent not found",
          message: `Agent '${agentId}' does not exist`,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const registeredAgent = agents[agentId] as AbstractAgent;
    const agent = registeredAgent.clone() as AbstractAgent;

    // Apply runtime-level A2UI middleware if configured
    if (runtime.a2ui) {
      const { agents: targetAgents, ...a2uiOptions } = runtime.a2ui;
      const shouldApply = !targetAgents || targetAgents.includes(agentId);
      if (
        shouldApply &&
        "use" in agent &&
        typeof (agent as any).use === "function"
      ) {
        (agent as any).use(new A2UIMiddleware(a2uiOptions));
      }
    }

    if (runtime.mcpApps?.servers?.length) {
      const mcpServers = runtime.mcpApps.servers
        .filter((s) => !s.agentId || s.agentId === agentId)
        .map(({ agentId: _, ...server }) => server);

      if (
        mcpServers.length > 0 &&
        "use" in agent &&
        typeof (agent as any).use === "function"
      ) {
        (agent as any).use(new MCPAppsMiddleware({ mcpServers }));
      }
    }

    if (agent && "headers" in agent) {
      const forwardableHeaders = extractForwardableHeaders(request);
      agent.headers = {
        ...(agent.headers as Record<string, string>),
        ...forwardableHeaders,
      };
    }

    let input: RunAgentInput;
    try {
      const requestBody = await request.json();
      input = RunAgentInputSchema.parse(requestBody);
    } catch (error) {
      console.error("Invalid run request body:", error);
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
          details: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    agent.setMessages(input.messages);
    agent.setState(input.state);
    agent.threadId = input.threadId;

    if (isIntelligenceRuntime(runtime)) {
      return handleIntelligenceRun({
        runtime: runtime as CopilotIntelligenceRuntimeLike,
        request,
        agentId,
        agent,
        input,
      });
    }

    return handleSseRun({ runtime, request, agent, input });
  } catch (error) {
    console.error("Error running agent:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace",
    );
    console.error("Error details:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
    });

    return new Response(
      JSON.stringify({
        error: "Failed to run agent",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
