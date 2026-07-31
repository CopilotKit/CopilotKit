import { isIntelligenceRuntime } from "../core/runtime";
import { telemetry } from "../telemetry";
import type { RunAgentParameters } from "./shared/agent-utils";
import {
  attachIntelligenceEnterpriseLearning,
  cloneAgentForRequest,
  configureAgentForRequest,
  parseRunRequest,
} from "./shared/agent-utils";
import { handleIntelligenceRun } from "./intelligence/run";
import { handleSseRun } from "./sse/run";

export async function handleRunAgent({
  runtime,
  request,
  agentId,
}: RunAgentParameters) {
  (runtime.telemetry ?? telemetry).capture(
    "oss.runtime.copilot_request_created",
    {
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
    },
  );

  try {
    const agent = await cloneAgentForRequest(runtime, agentId, request);
    if (agent instanceof Response) {
      return agent;
    }

    // Ensure the clone carries the registry key so InMemoryAgentRunner can
    // tag historic runs with the correct agentId for filtering.
    agent.agentId = agentId;

    // Parse the body before configuring middleware: the request is single-read,
    // and middleware configuration needs the A2UI catalog signal the React
    // provider forwards (see `a2uiCatalogAvailable` below). Middleware is applied
    // to the agent here; the run itself is kicked off later, so this is safe.
    const input = await parseRunRequest(request);
    if (input instanceof Response) {
      return input;
    }

    // `<CopilotKit a2ui={{ catalog }}>` forwards this flag on every run. Its
    // presence alone is enough to turn A2UI on end-to-end — no runtime-side
    // `a2ui` config required.
    const providerA2UIHasCatalog =
      (input.forwardedProps as Record<string, unknown> | undefined)
        ?.a2uiCatalogAvailable === true;

    configureAgentForRequest({
      runtime,
      request,
      agentId,
      agent,
      providerA2UIHasCatalog,
    });
    await attachIntelligenceEnterpriseLearning({ runtime, request, agent });

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
