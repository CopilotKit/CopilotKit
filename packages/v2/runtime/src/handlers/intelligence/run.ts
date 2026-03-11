import { AbstractAgent, Message, RunAgentInput } from "@ag-ui/client";
import { CopilotIntelligenceRuntimeLike } from "../../runtime";
import { jsonResponse } from "../shared/json-response";
import { isValidIdentifier } from "../shared/intelligence-utils";
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
        error: "Intelligence not configured",
        message: "Intelligence mode requires a CopilotKitIntelligence",
      },
      500,
    );
  }

  const userId = request.headers.get("X-User-Id");
  if (!isValidIdentifier(userId)) {
    return jsonResponse(
      {
        error: "X-User-Id header is required",
        message: "A valid X-User-Id header is required",
      },
      400,
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
        console.error("Failed to generate thread name:", nameError);
      });
    }
  } catch (error) {
    console.error("Failed to get or create thread:", error);
    return jsonResponse(
      {
        error: "Failed to initialize thread",
      },
      502,
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
    console.error("Thread lock denied:", error);
    return jsonResponse(
      {
        error: "Thread lock denied",
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
      console.error("Thread history lookup failed:", error);
      return jsonResponse(
        {
          error: "Thread history lookup failed",
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
    },
  });
}
