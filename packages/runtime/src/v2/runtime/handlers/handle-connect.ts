import { handleIntelligenceConnect } from "./intelligence/connect";
import { handleSseConnect } from "./sse/connect";
import { isIntelligenceRuntime } from "../core/runtime";
import { telemetry } from "../telemetry";
import { logger } from "@copilotkit/shared";
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
        agentId,
        threadId: connectRequest.input.threadId,
        restore: connectRequest.restore,
      });
    }

    return handleSseConnect({
      runtime,
      request,
      agentId,
      threadId: connectRequest.input.threadId,
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        agentId,
      },
      "Connect request handling failed",
    );

    return new Response(
      JSON.stringify({
        error: "Failed to connect agent",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
