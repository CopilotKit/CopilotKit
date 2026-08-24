import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import type { ResolvedDebugConfig } from "@copilotkit/shared";
import type { CopilotRuntimeLogger } from "../../../../v1-deprecated/lib/logger";
import type { CopilotRuntimeLike } from "../../core/runtime";
import { getRuntimeErrorReporter } from "../../core/runtime-error-reporter";
import { createSseEventResponse } from "../shared/sse-response";

interface HandleSseRunParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  agent: AbstractAgent;
  input: RunAgentInput;
  agentId: string;
  debug?: ResolvedDebugConfig;
  /** Pre-created logger instance to avoid creating a new pino logger per request. */
  logger?: CopilotRuntimeLogger;
  startTime?: number;
}

export function handleSseRun({
  runtime,
  request,
  agent,
  input,
  agentId,
  debug,
  logger,
  startTime,
}: HandleSseRunParams): Response {
  return createSseEventResponse({
    request,
    debugEventBus: runtime.debugEventBus,
    agentId,
    debug,
    logger,
    runtimeErrorReporter: getRuntimeErrorReporter(runtime),
    startTime,
    observableFactory: () =>
      runtime.runner.run({
        threadId: input.threadId,
        agent,
        input,
      }),
  });
}
