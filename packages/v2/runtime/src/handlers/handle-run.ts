import { isIntelligenceRuntime } from "../runtime";
import {
  cloneAgentForRequest,
  configureAgentForRequest,
  parseRunRequest,
  RunAgentParameters,
} from "./shared/agent-utils";
import { handleIntelligenceRun } from "./intelligence/run";
import { handleSseRun } from "./sse/run";

export async function handleRunAgent({
  runtime,
  request,
  agentId,
}: RunAgentParameters) {
  try {
    const agent = await cloneAgentForRequest(runtime, agentId);
    if (agent instanceof Response) {
      return agent;
    }

    configureAgentForRequest({ runtime, request, agentId, agent });

    const input = await parseRunRequest(request);
    if (input instanceof Response) {
      return input;
    }

    agent.setMessages(input.messages);
    agent.setState(input.state);
    agent.threadId = input.threadId;

    if (isIntelligenceRuntime(runtime)) {
      return handleIntelligenceRun({
        runtime,
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

    return Response.json(
      {
        error: "Failed to run agent",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
