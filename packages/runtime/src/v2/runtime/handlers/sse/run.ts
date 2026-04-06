import { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { CopilotRuntimeLike } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";

interface HandleSseRunParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  agent: AbstractAgent;
  input: RunAgentInput;
}

export function handleSseRun({
  runtime,
  request,
  agent,
  input,
}: HandleSseRunParams): Response {
  return createSseEventResponse({
    request,
    observableFactory: () =>
      runtime.runner.run({
        threadId: input.threadId,
        agent,
        input,
      }),
  });
}
