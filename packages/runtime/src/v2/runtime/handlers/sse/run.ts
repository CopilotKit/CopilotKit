import { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { ResolvedDebugConfig } from "@copilotkit/shared";
import { type CopilotRuntimeLogger } from "../../../../lib/logger";
import { CopilotRuntimeLike } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";

interface HandleSseRunParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  agent: AbstractAgent;
  input: RunAgentInput;
  debug?: ResolvedDebugConfig;
  /** Pre-created logger instance to avoid creating a new pino logger per request. */
  logger?: CopilotRuntimeLogger;
}

export function handleSseRun({
  runtime,
  request,
  agent,
  input,
  debug,
  logger,
}: HandleSseRunParams): Response {
  return createSseEventResponse({
    request,
    debug,
    logger,
    observableFactory: () =>
      runtime.runner.run({
        threadId: input.threadId,
        agent,
        input,
      }),
  });
}
