import { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { CopilotRuntimeLike } from "../../runtime";
import { createSseEventResponse } from "../shared/sse-response";
import { extractForwardableHeaders } from "../header-utils";

interface HandleSseConnectParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  agent: AbstractAgent;
  input: RunAgentInput;
  threadId: string;
}

export function handleSseConnect({
  runtime,
  request,
  agent,
  input,
  threadId,
}: HandleSseConnectParams): Response {
  return createSseEventResponse({
    request,
    observableFactory: () =>
      runtime.runner.connect({
        threadId,
        agent,
        input,
        headers: extractForwardableHeaders(request),
      }),
  });
}
