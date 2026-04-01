import { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { ResolvedDebugConfig } from "@copilotkit/shared";
import { CopilotRuntimeLike } from "../../runtime";
import { createSseEventResponse } from "../shared/sse-response";

interface HandleSseRunParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  agent: AbstractAgent;
  input: RunAgentInput;
  debug?: ResolvedDebugConfig;
}

export function handleSseRun({
  runtime,
  request,
  agent,
  input,
  debug,
}: HandleSseRunParams): Response {
  return createSseEventResponse({
    request,
    debug,
    observableFactory: () =>
      runtime.runner.run({
        threadId: input.threadId,
        agent,
        input,
      }),
  });
}
