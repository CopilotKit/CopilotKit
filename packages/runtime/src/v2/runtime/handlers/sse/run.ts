import type { AbstractAgent, BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { isThreadAccessDeniedError } from "../../runner/agent-runner";
import { threadAccessDeniedResponse } from "../shared/thread-access";
import type { ResolvedDebugConfig, ModelHostClass } from "@copilotkit/shared";
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
  /** Identity the run acts as; the runner records it as the thread owner. */
  ownerId?: string;
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
  ownerId,
}: HandleSseRunParams): Response {
  // Start the run before the stream opens. When another identity claimed the
  // thread after the handler's owner check, the runner refuses at once, and
  // that refusal becomes the same HTTP error as the check's, not a streamed
  // agent failure. Any other start error still reaches the client as a
  // RUN_ERROR on the stream, as before.
  let started: Observable<BaseEvent> | undefined;
  let startError: unknown;
  try {
    started = runtime.runner.run({
      threadId: input.threadId,
      agent,
      input,
      ...(ownerId === undefined ? {} : { ownerId }),
    });
  } catch (error) {
    if (isThreadAccessDeniedError(error)) {
      console.warn(
        "[CopilotKit] Run refused: the thread belongs to another identity.",
      );
      return threadAccessDeniedResponse();
    }
    startError = error;
  }

  return createSseEventResponse({
    request,
    debugEventBus: runtime.debugEventBus,
    agentId,
    debug,
    logger,
    runtimeErrorReporter: getRuntimeErrorReporter(runtime),
    startTime,
    telemetry: runtime.telemetry,
    keepAliveIntervalSeconds: runtime.sseKeepAliveIntervalSeconds,
    // Read structurally rather than via `instanceof BuiltInAgent`, which would
    // pull the agent module into this handler. Any agent can opt in by
    // exposing the same property.
    executionSeed: {
      llmHostClass:
        (agent as { modelHostClass?: ModelHostClass }).modelHostClass ??
        "unknown",
    },
    observableFactory: () => {
      if (started === undefined) throw startError;
      return started;
    },
  });
}
