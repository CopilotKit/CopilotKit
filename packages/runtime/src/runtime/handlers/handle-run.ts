import { readCopilotKitUIEnvelope } from "@copilotkit/shared";
import { isIntelligenceRuntime } from "../core/runtime";
import { getRuntimeLogger } from "../core/logger";
import { telemetry } from "../telemetry";
import { readGuardrailsEnabled } from "./shared/cloud-telemetry";
import type { RunAgentParameters } from "./shared/agent-utils";
import {
  attachIntelligenceEnterpriseLearning,
  cloneAgentForRequest,
  configureAgentForRequest,
  parseRunRequest,
} from "./shared/agent-utils";
import { handleIntelligenceRun } from "./intelligence/run";
import { takeAnalyticsContext } from "../intelligence-platform/analytics-context";
import { handleSseRun } from "./sse/run";
import { getRuntimeErrorReporter } from "../core/runtime-error-reporter";
import { enforcesThreadOwnership } from "../runner/agent-runner";
import {
  resolveLocalThreadOwner,
  threadAccessDeniedResponse,
} from "./shared/thread-access";

export async function handleRunAgent({
  runtime,
  request,
  agentId,
}: RunAgentParameters) {
  const startTime = Date.now();
  const publicApiKey = request.headers.get("x-copilotcloud-public-api-key");
  void (runtime.telemetry ?? telemetry).capture(
    "oss.runtime.copilot_request_created",
    {
      "cloud.guardrails.enabled": await readGuardrailsEnabled(request),
      requestType: "run",
      "cloud.api_key_provided": !!publicApiKey,
      ...(publicApiKey ? { "cloud.public_api_key": publicApiKey } : {}),
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

    // Parse the body before configuring middleware: middleware configuration
    // needs the generative UI envelope the React provider forwards (see
    // `providerGenerativeUITransport` below). Middleware is applied to the agent here;
    // the run itself is kicked off later, so this is safe. The body is read
    // from a clone, so `identifyUser` can still read the original request.
    const parsed = await parseRunRequest(
      request.clone(),
      getRuntimeLogger(runtime),
    );
    if (parsed instanceof Response) {
      return parsed;
    }
    // An app's analytics context is for Intelligence's lock request alone, so
    // it is taken off the input before anything hands that input to an agent.
    const { input, analyticsContext } = takeAnalyticsContext(parsed);

    // A thread belongs to the identity of its first run. Running needs no
    // configured identity (anonymous runs keep working), but nobody may add to
    // a thread that another identity owns.
    let ownerId: string | undefined;
    if (!isIntelligenceRuntime(runtime)) {
      const owner = await resolveLocalThreadOwner({
        runtime,
        request,
        operation: "run",
      });
      if (owner instanceof Response) return owner;
      if (
        enforcesThreadOwnership(runtime.runner) &&
        !(await runtime.runner.isThreadAccessible(input.threadId, {
          ownerId: owner,
        }))
      ) {
        return threadAccessDeniedResponse();
      }
      ownerId = owner;
    }

    // The generative UI envelope (`forwardedProps.copilotkit.ui`) picks the
    // transport of this run.
    const providerGenerativeUITransport = readCopilotKitUIEnvelope(
      input.forwardedProps,
    )?.metadata.extensions.copilotkit_transport;

    configureAgentForRequest({
      runtime,
      request,
      agentId,
      agent,
      providerGenerativeUITransport,
      isMcpProxyRequest: Object.prototype.hasOwnProperty.call(
        input.forwardedProps ?? {},
        "__proxiedMCPRequest",
      ),
    });
    const memoryResponse = await attachIntelligenceEnterpriseLearning({
      runtime,
      request,
      agent,
    });
    if (memoryResponse instanceof Response) return memoryResponse;

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
        analyticsContext,
        startTime,
      });
    }

    return handleSseRun({
      runtime,
      request,
      agent,
      input,
      agentId,
      debug: runtime.debug,
      debugLogger: runtime.debugLogger,
      startTime,
      ownerId,
    });
  } catch (error) {
    getRuntimeErrorReporter(runtime)?.report({
      request,
      error,
      operation: "agent.run",
      agentId,
      phase: "common",
      startTime,
    });
    getRuntimeLogger(runtime).error({ err: error }, "Error running agent");

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
