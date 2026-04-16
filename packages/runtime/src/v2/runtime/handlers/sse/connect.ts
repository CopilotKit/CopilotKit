import { CopilotRuntimeLike } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";
import { extractForwardableHeaders } from "../header-utils";

interface HandleSseConnectParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  threadId: string;
}

export function handleSseConnect({
  runtime,
  request,
  threadId,
}: HandleSseConnectParams): Response {
  return createSseEventResponse({
    request,
    debugEventBus: runtime.debugEventBus,
    agentId: "connect",
    observableFactory: () =>
      runtime.runner.connect({
        threadId,
        headers: extractForwardableHeaders(request),
      }),
  });
}
