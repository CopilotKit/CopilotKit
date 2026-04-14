import { AbstractAgent } from "@ag-ui/client";
import { CopilotRuntimeLike } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";
import { extractForwardableHeaders } from "../header-utils";

interface HandleSseConnectParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  threadId: string;
  agent?: AbstractAgent;
}

export function handleSseConnect({
  runtime,
  request,
  threadId,
  agent,
}: HandleSseConnectParams): Response {
  return createSseEventResponse({
    request,
    observableFactory: () =>
      runtime.runner.connect({
        threadId,
        agent,
        headers: extractForwardableHeaders(request),
      }),
  });
}
