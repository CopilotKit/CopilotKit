import { AbstractAgent, Message, RunAgentInput } from "@ag-ui/client";
import { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import { generateThreadNameForNewThread } from "./thread-names";
import { logger } from "@copilotkit/shared";
import { telemetry } from "../../telemetry";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { isHandlerResponse } from "../shared/json-response";

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

  let joinCode: string | undefined;
  let joinToken: string | undefined;
  try {
    const lockResult = await runtime.intelligence.ɵacquireThreadLock({
      threadId: input.threadId,
      runId: input.runId,
      userId,
      ...(runtime.lockKeyPrefix !== undefined
        ? { lockKeyPrefix: runtime.lockKeyPrefix }
        : {}),
      ttlSeconds: runtime.lockTtlSeconds,
    });
    joinToken = lockResult.joinToken;
    joinCode = lockResult.joinCode;
  } catch (error) {
    logger.error("Thread lock denied:", error);
    return Response.json(
      {
        error: "Thread lock denied",
      },
      { status: 409 },
    );
  }

  if (!joinToken) {
    return Response.json(
      {
        error: "Join token not available",
        message: "Intelligence platform did not return a join token",
      },
      { status: 502 },
    );
  }

  let persistedInputMessages: Message[] | undefined;
  if (Array.isArray(input.messages)) {
    try {
      const history = await runtime.intelligence.getThreadMessages({
        threadId: input.threadId,
      });
      const historicMessageIds = new Set(
        history.messages.map((message) => message.id),
      );
      persistedInputMessages = input.messages.filter(
        (message) => !historicMessageIds.has(message.id),
      );
    } catch (error) {
      logger.error("Thread history lookup failed:", error);
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
        threadId: input.threadId,
        runId: input.runId,
        ttlSeconds: runtime.lockTtlSeconds,
        ...(runtime.lockKeyPrefix !== undefined
          ? { lockKeyPrefix: runtime.lockKeyPrefix }
          : {}),
      })
      .catch((err) => {
        logger.error("Failed to renew thread lock:", err);
      });
  }, runtime.lockHeartbeatIntervalSeconds * 1_000);

  const clearHeartbeat = () => {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  runtime.runner
    .run({
      threadId: input.threadId,
      agent,
      input,
      ...(persistedInputMessages !== undefined
        ? { persistedInputMessages }
        : {}),
      ...(joinCode ? { joinCode } : {}),
    })
    .subscribe({
      error: (error) => {
        clearHeartbeat();
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

  return Response.json(
    { joinToken },
    {
      headers: { "Cache-Control": "no-cache" },
    },
  );
}
