import { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { CopilotRuntimeLike } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";

interface HandleSseRunParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  agent: AbstractAgent;
  input: RunAgentInput;
  agentId: string;
}

export function handleSseRun({
  runtime,
  request,
  agent,
  input,
  agentId,
}: HandleSseRunParams): Response {
  return createSseEventResponse({
    request,
    debugEventBus: runtime.debugEventBus,
    agentId,
    observableFactory: () =>
      runtime.runner.run({
        threadId: input.threadId,
        agent,
        input,
      }),
  });
}
