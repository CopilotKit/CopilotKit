import { isIntelligenceRuntime } from "../core/runtime";
import { telemetry } from "../telemetry";
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
  telemetry.capture("oss.runtime.copilot_request_created", {
    "cloud.guardrails.enabled": false,
    requestType: "run",
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

    configureAgentForRequest({ runtime, request, agentId, agent });

    if (
      runtime.licenseChecker &&
      !runtime.licenseChecker.checkFeature("agents")
    ) {
      console.warn(
        '[CopilotKit Runtime] Warning: "agents" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }

    const input = await parseRunRequest(request);
    if (input instanceof Response) {
      return input;
    }

    agent.setMessages(input.messages);
    agent.setState(input.state);
    agent.threadId = input.threadId;

    if (runtime.debug?.lifecycle && runtime.debugLogger) {
      runtime.debugLogger.debug(
        { agentName: agentId, threadId: input.threadId },
        "Agent run started",
      );
    }

    if (isIntelligenceRuntime(runtime)) {
      return handleIntelligenceRun({
        runtime,
        request,
        agentId,
        agent,
        input,
      });
    }

    return handleSseRun({
      runtime,
      request,
      agent,
      input,
      agentId,
      debug: runtime.debug,
      logger: runtime.debugLogger,
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
