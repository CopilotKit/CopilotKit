import { AbstractAgent, Message, RunAgentInput } from "@ag-ui/client";
import { CopilotIntelligenceRuntimeLike } from "../../runtime";
import { isValidIdentifier } from "../shared/intelligence-utils";
import { generateThreadNameForNewThread } from "./thread-names";
import { logger } from "@copilotkitnext/shared";

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

  const userId = request.headers.get("X-User-Id");
  if (!isValidIdentifier(userId)) {
    return Response.json(
      {
        error: "X-User-Id header is required",
        message: "A valid X-User-Id header is required",
      },
      { status: 400 },
    );
  }

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
        logger.error("Error running agent:", error);
      },
    });

  return Response.json(
    { joinToken },
    {
      headers: { "Cache-Control": "no-cache" },
    },
  );
}
