import type { AbstractAgent } from "@ag-ui/client";
import type { CopilotRuntimeLike } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";

/**
 * `headers` lives on the HTTP-backed agent configs (e.g. `HttpAgent`), not on
 * the base `AbstractAgent`. Mirror the runtime's own optional-headers shape so
 * we can read server-configured headers off the per-request clone without a
 * cast. See `agent-utils.ts`.
 */
type AgentWithHeaders = AbstractAgent & {
  headers?: Record<string, string>;
};

interface HandleSseConnectParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  agentId: string;
  threadId: string;
  /**
   * The per-request agent clone, carrying any server-configured `agent.headers`
   * (e.g. service-to-service auth). The merged headers are computed once by
   * `applyForwardedRequestHeaders` in `handle-connect.ts` and read below.
   */
  agent?: AgentWithHeaders;
}

export function handleSseConnect({
  runtime,
  request,
  agentId,
  threadId,
  agent,
}: HandleSseConnectParams): Response {
  return createSseEventResponse({
    request,
    debugEventBus: runtime.debugEventBus,
    // Forward the real agentId so debug envelopes reflect the agent the
    // route resolved to — not the literal string "connect".
    agentId,
    observableFactory: () =>
      runtime.runner.connect({
        threadId,
        agentId,
        // `applyForwardedRequestHeaders` computed this once on the connect
        // clone. Server-configured headers win case-insensitively (#5712/#5782).
        // No shipped runner consumes AgentRunnerConnectRequest.headers today;
        // every runner reads threadId/agentId only. This remains forward-looking
        // plumbing for a future outbound-connecting runner.
        headers: agent?.headers ?? {},
      }),
  });
}
