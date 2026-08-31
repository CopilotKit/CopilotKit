import { handleIntelligenceConnect } from "./intelligence/connect";
import { handleSseConnect } from "./sse/connect";
import { isIntelligenceRuntime } from "../core/runtime";
import { telemetry } from "../telemetry";
import type { RunAgentParameters as ConnectAgentParameters } from "./shared/agent-utils";
import {
  parseConnectRequest,
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
    // Runs on BOTH branches deliberately: this is the only place the connect
    // path validates that `agentId` exists, returning a 404 `Response` for an
    // unknown agent. The intelligence branch below never re-checks the id (it
    // hands `agentId` straight to `ɵconnectThread`), so this clone/resolve must
    // happen before the branch split or unknown agents would slip through. The
    // SSE branch additionally uses the returned clone's `agent.headers`.
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
      });
    }

    return handleSseConnect({
      runtime,
      request,
      agentId,
      threadId: connectRequest.input.threadId,
      // Pass the per-request clone so its server-configured `agent.headers` are
      // folded into the merged header set threaded into `runner.connect`. That
      // merge is forward-looking plumbing — no shipped runner consumes
      // connect-path headers yet; see the note in `sse/connect.ts`.
      agent,
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
