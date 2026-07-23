import type { AbstractAgent } from "@ag-ui/client";
import type { CopilotRuntimeLike } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";
import {
  mergeForwardableHeaders,
  resolveForwardHeadersPolicy,
} from "../header-utils";

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
   * (e.g. service-to-service auth). Used only to compute the merged header set
   * threaded into `runner.connect` below — see the note there for why that
   * merge is forward-looking plumbing rather than active outbound auth today.
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
        // Forward-looking plumbing: we compute the merged header set (server
        // `agent.headers` win on collision, case-insensitively; non-colliding
        // inbound headers still forward — see `mergeForwardableHeaders`, #5712)
        // and thread it into `runner.connect`. NO shipped runner consumes the
        // `headers` field of `AgentRunnerConnectRequest` today — every runner
        // (in-memory, intelligence, telemetry, sqlite) reads only `threadId`.
        // The real outbound header forwarding is the /run path, where
        // `cloneAgentForRequest` mutates `agent.headers` directly
        // (agent-utils.ts). This wiring exists so a future outbound-connecting
        // runner can pick the merged headers up without a route change; the
        // collision precedence noted here is purely about that merge, not about
        // middleware/mutation parity with /run.
        headers: mergeForwardableHeaders(
          agent?.headers,
          request,
          // Optional on `CopilotRuntimeLike` (non-breaking minor release);
          // coalesce a policy-less external implementor to the default resolved
          // policy (default-on denylist) instead of dereffing undefined.
          runtime.forwardHeadersPolicy ??
            resolveForwardHeadersPolicy(undefined),
        ),
      }),
  });
}
