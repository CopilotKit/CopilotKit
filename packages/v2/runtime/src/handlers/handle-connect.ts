import { handleIntelligenceConnect } from "./intelligence/connect";
import { handleSseConnect } from "./sse/connect";
import { isIntelligenceRuntime } from "../runtime";
import {
  parseConnectRequest,
  RunAgentParameters as ConnectAgentParameters,
  cloneAgentForRequest,
} from "./shared/agent-utils";

export async function handleConnectAgent({
  runtime,
  request,
  agentId,
}: ConnectAgentParameters) {
  try {
    const agent = await cloneAgentForRequest(runtime, agentId);
    if (agent instanceof Response) {
      return agent;
    }

    const connectRequest = await parseConnectRequest(request);
    if (connectRequest instanceof Response) {
      return connectRequest;
    }

    if (isIntelligenceRuntime(runtime)) {
      return handleIntelligenceConnect({
        runtime,
        threadId: connectRequest.input.threadId,
        lastSeenEventId: connectRequest.lastSeenEventId,
      });
    }

    return handleSseConnect({
      runtime,
      request,
      threadId: connectRequest.input.threadId,
    });
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
