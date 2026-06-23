import { AbstractAgent } from "@ag-ui/client";
import { CopilotRuntimeLike } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";
import { extractForwardableHeaders } from "../header-utils";

interface HandleSseConnectParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  agentId: string;
  threadId: string;
  agent?: AbstractAgent;
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
        agent,
        headers: extractForwardableHeaders(request),
      }),
  });
}
