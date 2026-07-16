import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import { generateThreadNameForNewThread } from "./thread-names";
import { logger } from "@copilotkit/shared";
import { telemetry } from "../../telemetry";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { isHandlerResponse } from "../shared/json-response";
import type { AgentRunnerRunRequest } from "../../runner/agent-runner";
import type { Observable } from "rxjs";

const INTELLIGENCE_CONTRACTS_SPECIFIER = "@copilotkit/intelligence";

interface LearningContainerIdSchema {
  safeParse(
    value: unknown,
  ): { success: true; data: string | null } | { success: false };
}

interface IntelligenceContractsModule {
  learningContainerIdSchema: LearningContainerIdSchema;
}

async function loadLearningContainerIdSchema(): Promise<LearningContainerIdSchema> {
  const contracts = (await import(
    INTELLIGENCE_CONTRACTS_SPECIFIER
  )) as IntelligenceContractsModule;
  return contracts.learningContainerIdSchema;
}

/**
 * Builds browser-facing realtime connection metadata owned by the runtime.
 */
function buildRealtimeConnectionInfo(params: {
  clientUrl: string;
  threadId: string;
}): { clientUrl: string; topic: string } {
  return {
    clientUrl: params.clientUrl,
    topic: `thread:${params.threadId}`,
  };
}

interface RunnerStartupBoundary {
  events: Observable<BaseEvent>;
  startup: Promise<void>;
}

interface RunnerWithStartupBoundary {
  runWithStartupBoundary(request: AgentRunnerRunRequest): RunnerStartupBoundary;
}

function hasRunnerStartupBoundary(
  runner: CopilotIntelligenceRuntimeLike["runner"],
): runner is CopilotIntelligenceRuntimeLike["runner"] &
  RunnerWithStartupBoundary {
  const candidate = runner as { runWithStartupBoundary?: unknown };

  return (
    typeof candidate.runWithStartupBoundary === "function" &&
    (Object.prototype.hasOwnProperty.call(runner, "runWithStartupBoundary") ||
      Object.prototype.hasOwnProperty.call(runner, "threads"))
  );
}

interface HandleIntelligenceRunParams {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  agentId: string;
  agent: AbstractAgent;
  input: RunAgentInput;
}

type AssignmentEcho = {
  learningContainerId?: unknown;
  assignmentRevision?: unknown;
};

function validateAssignmentEcho(
  echo: AssignmentEcho,
  expectedLearningContainerId: string | null,
  learningContainerIdSchema: LearningContainerIdSchema,
): "valid" | "malformed" | "mismatch" {
  if (
    !Object.prototype.hasOwnProperty.call(echo, "learningContainerId") ||
    !Object.prototype.hasOwnProperty.call(echo, "assignmentRevision")
  ) {
    return "malformed";
  }

  const parsedAssignment = learningContainerIdSchema.safeParse(
    echo.learningContainerId,
  );
  if (
    !parsedAssignment.success ||
    !Number.isInteger(echo.assignmentRevision) ||
    (echo.assignmentRevision as number) < 0
  ) {
    return "malformed";
  }

  return parsedAssignment.data === expectedLearningContainerId
    ? "valid"
    : "mismatch";
}

function assignmentValidationResponse(
  result: "malformed" | "mismatch",
): Response {
  if (result === "mismatch") {
    return Response.json(
      { error: "Learning container assignment conflict" },
      { status: 409 },
    );
  }

  return Response.json(
    { error: "Invalid learning container assignment echo" },
    { status: 502 },
  );
}

export async function handleIntelligenceRun({
  runtime,
  request,
  agentId,
  agent,
  input,
}: HandleIntelligenceRunParams): Promise<Response> {
  if (!runtime.intelligence) {
    return Response.json(
      {
        error: "Intelligence not configured",
        message: "Intelligence mode requires a CopilotKitIntelligence",
      },
      { status: 500 },
    );
  }

  const user = await resolveIntelligenceUser({ runtime, request });
  if (isHandlerResponse(user)) {
    return user;
  }
  const userId = user.id;

  const assignmentResolutionConfigured =
    runtime.resolveLearningContainer !== undefined;
  let learningContainerId: string | null | undefined;
  let learningContainerIdSchema: LearningContainerIdSchema | undefined;
  if (runtime.resolveLearningContainer) {
    try {
      learningContainerIdSchema = await loadLearningContainerIdSchema();
      const resolvedAssignment = await runtime.resolveLearningContainer({
        request,
        threadId: input.threadId,
        agentId,
        user,
      });
      const parsedAssignment =
        learningContainerIdSchema.safeParse(resolvedAssignment);
      if (!parsedAssignment.success) {
        logger.error(
          "resolveLearningContainer returned an invalid learning container assignment",
        );
        return Response.json(
          { error: "Invalid learning container assignment" },
          { status: 500 },
        );
      }
      learningContainerId = parsedAssignment.data;
    } catch (error) {
      logger.error("Failed to resolve learning container assignment:", error);
      return Response.json(
        { error: "Failed to resolve learning container assignment" },
        { status: 500 },
      );
    }
  }

  let threadResult: Awaited<
    ReturnType<typeof runtime.intelligence.getOrCreateThread>
  >;
  try {
    threadResult = await runtime.intelligence.getOrCreateThread({
      threadId: input.threadId,
      userId,
      agentId,
      ...(assignmentResolutionConfigured ? { learningContainerId } : {}),
    });
  } catch (error) {
    logger.error("Failed to get or create thread:", error);
    return Response.json(
      {
        error: "Failed to initialize thread",
      },
      { status: 502 },
    );
  }

  const { thread, created } = threadResult;
  if (assignmentResolutionConfigured) {
    const validation = validateAssignmentEcho(
      thread,
      learningContainerId as string | null,
      learningContainerIdSchema as LearningContainerIdSchema,
    );
    if (validation !== "valid") {
      return assignmentValidationResponse(validation);
    }
  }

  if (created && runtime.generateThreadNames && !thread.name?.trim()) {
    void generateThreadNameForNewThread({
      runtime,
      request,
      agentId,
      sourceInput: input,
      thread,
      userId,
    }).catch((nameError) => {
      logger.error("Failed to generate thread name:", nameError);
    });
  }

  let canonicalThreadId = input.threadId;
  let canonicalRunId = input.runId;
  let joinToken: string | undefined;
  let lockResult: Awaited<
    ReturnType<typeof runtime.intelligence.ɵacquireThreadLock>
  >;
  try {
    lockResult = await runtime.intelligence.ɵacquireThreadLock({
      threadId: input.threadId,
      runId: input.runId,
      userId,
      agentId,
      ...(assignmentResolutionConfigured ? { learningContainerId } : {}),
      ...(runtime.lockKeyPrefix !== undefined
        ? { lockKeyPrefix: runtime.lockKeyPrefix }
        : {}),
      ttlSeconds: runtime.lockTtlSeconds,
    });
    canonicalThreadId = lockResult.threadId;
    canonicalRunId = lockResult.runId;
    joinToken = lockResult.joinToken;
  } catch (error) {
    logger.error("Thread lock denied:", error);
    return Response.json(
      {
        error: "Thread lock denied",
      },
      { status: 409 },
    );
  }

  const cleanupLock = (reason: string): Promise<void> =>
    runtime.intelligence
      .ɵcleanupThreadLock({
        threadId: canonicalThreadId || input.threadId,
        runId: canonicalRunId || input.runId,
      })
      .catch((cleanupError) => {
        logger.error(
          { err: cleanupError, reason },
          "Failed to cleanup thread lock",
        );
      });

  if (assignmentResolutionConfigured) {
    const validation = validateAssignmentEcho(
      lockResult,
      learningContainerId as string | null,
      learningContainerIdSchema as LearningContainerIdSchema,
    );
    if (validation !== "valid") {
      await cleanupLock(
        validation === "mismatch"
          ? "assignment-echo-mismatch"
          : "malformed-assignment-echo",
      );
      return assignmentValidationResponse(validation);
    }
  }

  if (!canonicalThreadId || !canonicalRunId || !joinToken) {
    await cleanupLock("malformed-lock-response");
    return Response.json(
      {
        error: "Run connection credentials not available",
        message:
          "Intelligence platform did not return canonical threadId, runId, and joinToken",
      },
      { status: 502 },
    );
  }

  const canonicalInput: RunAgentInput = {
    ...input,
    threadId: canonicalThreadId,
    runId: canonicalRunId,
  };

  let persistedInputMessages: Message[] | undefined;
  if (Array.isArray(input.messages)) {
    try {
      const history = await runtime.intelligence.getThreadMessages({
        threadId: canonicalThreadId,
        userId,
      });
      const historicMessageIds = new Set(
        history.messages.map((message) => message.id),
      );
      persistedInputMessages = input.messages.filter(
        (message) => !historicMessageIds.has(message.id),
      );
    } catch (error) {
      logger.error("Thread history lookup failed:", error);
      await cleanupLock("thread-history-lookup-failed");
      return Response.json(
        {
          error: "Thread history lookup failed",
        },
        { status: 502 },
      );
    }
  }

  telemetry.capture("oss.runtime.agent_execution_stream_started", {});

  // Start heartbeat timer to renew the thread lock.
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  heartbeatTimer = setInterval(() => {
    runtime.intelligence
      .ɵrenewThreadLock({
        threadId: canonicalThreadId,
        runId: canonicalRunId,
        ttlSeconds: runtime.lockTtlSeconds,
        ...(runtime.lockKeyPrefix !== undefined
          ? { lockKeyPrefix: runtime.lockKeyPrefix }
          : {}),
      })
      .catch((err) => {
        logger.error("Failed to renew thread lock:", err);
        clearHeartbeat();
        try {
          agent.abortRun();
        } catch (abortError) {
          logger.error(
            "Failed to abort agent after lock renewal failure:",
            abortError,
          );
        }
      });
  }, runtime.lockHeartbeatIntervalSeconds * 1_000);

  const clearHeartbeat = () => {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const runStarted = { current: false };
  let immediateStartupErrorMessage: string | undefined;
  let immediateStartupCleanup: Promise<void> | undefined;

  const runRequest: AgentRunnerRunRequest = {
    threadId: canonicalThreadId,
    agent,
    input: canonicalInput,
    ...(persistedInputMessages !== undefined ? { persistedInputMessages } : {}),
  };

  try {
    const runStart = hasRunnerStartupBoundary(runtime.runner)
      ? runtime.runner.runWithStartupBoundary(runRequest)
      : {
          events: runtime.runner.run(runRequest),
          startup: Promise.resolve(),
        };

    runStart.events.subscribe({
      next: (event: BaseEvent) => {
        if (event.type === EventType.RUN_STARTED) {
          runStarted.current = true;
        }
        if (event.type === EventType.RUN_ERROR && !runStarted.current) {
          clearHeartbeat();
          immediateStartupErrorMessage =
            "message" in event && typeof event.message === "string"
              ? event.message
              : "Runner failed before the run started";
          immediateStartupCleanup = cleanupLock("runner-start-failed");
        }
      },
      error: (error) => {
        clearHeartbeat();
        if (!runStarted.current) {
          immediateStartupErrorMessage =
            error instanceof Error ? error.message : String(error);
          immediateStartupCleanup = cleanupLock("runner-start-error");
        } else {
          cleanupLock("runner-error");
        }
        telemetry.capture("oss.runtime.agent_execution_stream_errored", {
          error: error instanceof Error ? error.message : String(error),
        });
        logger.error("Error running agent:", error);
      },
      complete: () => {
        clearHeartbeat();
        telemetry.capture("oss.runtime.agent_execution_stream_ended", {});
      },
    });

    await runStart.startup;
  } catch (error) {
    clearHeartbeat();
    await (immediateStartupCleanup ?? cleanupLock("runner-start-threw"));
    logger.error("Error starting agent runner:", error);
    return Response.json(
      {
        error: "Failed to start runner",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  if (immediateStartupErrorMessage) {
    await immediateStartupCleanup;
    return Response.json(
      {
        error: "Failed to start runner",
        message: immediateStartupErrorMessage,
      },
      { status: 502 },
    );
  }

  // IntelligenceAgentRunner resolves this boundary after Phoenix channel join.
  // Other runner implementations fall back to construction/subscription errors.
  return Response.json(
    {
      threadId: canonicalThreadId,
      runId: canonicalRunId,
      joinToken,
      realtime: buildRealtimeConnectionInfo({
        clientUrl: runtime.intelligence.ɵgetClientWsUrl(),
        threadId: canonicalThreadId,
      }),
    },
    {
      headers: { "Cache-Control": "no-cache" },
    },
  );
}
