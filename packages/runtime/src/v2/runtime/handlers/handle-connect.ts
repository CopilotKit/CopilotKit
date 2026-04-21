import { handleIntelligenceConnect } from "./intelligence/connect";
import { handleSseConnect } from "./sse/connect";
import { isIntelligenceRuntime } from "../core/runtime";
import { telemetry } from "../telemetry";
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
  telemetry.capture("oss.runtime.copilot_request_created", {
    "cloud.guardrails.enabled": false,
    requestType: "connect",
    "cloud.api_key_provided": !!request.headers.get(
      "x-copilotcloud-public-api-key",
    ),
    ...(request.headers.get("x-copilotcloud-public-api-key")
      ? {
          "cloud.public_api_key": request.headers.get(
            "x-copilotcloud-public-api-key",
          )!,
        }
      : {}),
  });

  try {
    const agent = await cloneAgentForRequest(runtime, agentId, request);
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
        request,
        threadId: connectRequest.input.threadId,
        runId: connectRequest.input.runId,
        lastSeenEventId: connectRequest.lastSeenEventId,
      });
    }

    return handleSseConnect({
      runtime,
      request,
      threadId: connectRequest.input.threadId,
      runId: connectRequest.input.runId,
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
