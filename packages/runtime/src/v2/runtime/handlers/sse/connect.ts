import { CopilotRuntimeLike } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";
import { extractForwardableHeaders } from "../header-utils";

interface HandleSseConnectParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  threadId: string;
  runId: string;
}

export function handleSseConnect({
  runtime,
  request,
  threadId,
  runId,
}: HandleSseConnectParams): Response {
  return createSseEventResponse({
    request,
    observableFactory: () =>
      runtime.runner.connect({
        threadId,
        runId,
        headers: extractForwardableHeaders(request),
      }),
  });
}
