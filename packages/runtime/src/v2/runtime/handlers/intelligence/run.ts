import {
  AbstractAgent,
  BaseEvent,
  EventType,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import { generateThreadNameForNewThread } from "./thread-names";
import { logger } from "@copilotkit/shared";
import { telemetry } from "../../telemetry";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { isHandlerResponse } from "../shared/json-response";

/**
 * Builds browser-facing realtime connection metadata owned by the runtime.
 */
function buildRealtimeConnectionInfo(params: {
  clientUrl: string;
  threadId: string;
}): { clientUrl: string; threadTopic: string } {
  return {
    clientUrl: params.clientUrl,
    threadTopic: `thread:${params.threadId}`,
  };
}

interface HandleIntelligenceRunParams {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  agentId: string;
  agent: AbstractAgent;
  input: RunAgentInput;
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

  try {
    const { thread, created } = await runtime.intelligence.getOrCreateThread({
      threadId: input.threadId,
      userId,
      agentId,
    });

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
  } catch (error) {
    logger.error("Failed to get or create thread:", error);
    return Response.json(
      {
        error: "Failed to initialize thread",
      },
      { status: 502 },
    );
  }

  let canonicalThreadId = input.threadId;
  let canonicalRunId = input.runId;
  let joinToken: string | undefined;
  try {
    const lockResult = await runtime.intelligence.ɵacquireThreadLock({
      threadId: input.threadId,
      runId: input.runId,
      userId,
      agentId,
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

  try {
    runtime.runner
      .run({
        threadId: canonicalThreadId,
        agent,
        input: canonicalInput,
        ...(persistedInputMessages !== undefined
          ? { persistedInputMessages }
          : {}),
      })
      .subscribe({
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
  } catch (error) {
    clearHeartbeat();
    await cleanupLock("runner-start-threw");
    logger.error("Error starting agent runner:", error);
    return Response.json(
      {
        error: "Failed to start runner",
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

  // The Phoenix runner join is callback-based, so this handler cannot provide
  // a true synchronous join confirmation. It only catches immediate runner
  // construction/subscription failures before returning credentials.
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
