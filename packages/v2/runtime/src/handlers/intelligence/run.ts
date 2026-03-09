import { AbstractAgent, Message, RunAgentInput } from "@ag-ui/client";
import { CopilotIntelligenceRuntimeLike } from "../../runtime";
import { jsonResponse } from "../shared/json-response";
import { isPlatformNotFoundError } from "../shared/intelligence-utils";
import { generateThreadNameForNewThread } from "./thread-names";

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
    return jsonResponse(
      {
        error: "Intelligence SDK not configured",
        message: "Intelligence mode requires a CopilotKitIntelligence",
      },
      500,
    );
  }

  try {
    await runtime.intelligence.getThread({
      threadId: input.threadId,
    });
  } catch (error) {
    if (!isPlatformNotFoundError(error)) {
      return jsonResponse(
        {
          error: "Thread lookup failed",
          message: error instanceof Error ? error.message : String(error),
        },
        502,
      );
    }

    const userId = request.headers.get("X-User-Id");
    if (!userId) {
      return jsonResponse(
        {
          error: "Thread not found",
          message:
            "Thread does not exist and X-User-Id header is required to create it",
        },
        400,
      );
    }

    try {
      const created = await runtime.intelligence.createThread({
        threadId: input.threadId,
        userId,
        agentId,
      });
      if (runtime.generateThreadNames && !created.name?.trim()) {
        void generateThreadNameForNewThread({
          runtime,
          request,
          agentId,
          sourceInput: input,
          thread: created,
          userId,
        }).catch((nameError) => {
          console.error("Failed to generate thread name:", nameError);
        });
      }
    } catch (createError) {
      return jsonResponse(
        {
          error: "Failed to initialize thread",
          message:
            createError instanceof Error
              ? createError.message
              : String(createError),
        },
        500,
      );
    }
  }

  let joinCode: string | undefined;
  let joinToken: string | undefined;
  try {
    const lockResult = await runtime.intelligence.acquireThreadLock({
      threadId: input.threadId,
      runId: input.runId,
    });
    joinToken = lockResult.joinToken;
    joinCode = lockResult.joinCode;
  } catch (error) {
    return jsonResponse(
      {
        error: "Thread lock denied",
        message: error instanceof Error ? error.message : String(error),
      },
      409,
    );
  }

  if (!joinToken) {
    return jsonResponse(
      {
        error: "Join token not available",
        message: "Intelligence platform did not return a join token",
      },
      502,
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
      return jsonResponse(
        {
          error: "Thread history lookup failed",
          message: error instanceof Error ? error.message : String(error),
        },
        502,
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
        console.error("Error running agent:", error);
      },
    });

  return new Response(JSON.stringify({ joinToken }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
