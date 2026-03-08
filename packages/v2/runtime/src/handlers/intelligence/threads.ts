import {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeLike,
  isIntelligenceRuntime,
} from "../../runtime";
import { logger } from "@copilotkitnext/shared";
import { errorResponse, jsonResponse } from "../shared/json-response";

interface ThreadsHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

interface ThreadMutationParams extends ThreadsHandlerParams {
  threadId: string;
}

function requireIntelligenceRuntime(
  runtime: CopilotRuntimeLike,
): CopilotIntelligenceRuntimeLike | Response {
  if (!isIntelligenceRuntime(runtime)) {
    return errorResponse(
      "Threads are only available in Intelligence mode. Provide intelligenceSdk in CopilotRuntime options.",
      501,
    );
  }

  return runtime;
}

export async function handleListThreads({
  runtime,
  request,
}: ThreadsHandlerParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (intelligenceRuntime instanceof Response) {
    return intelligenceRuntime;
  }

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const agentId = url.searchParams.get("agentId");

    if (!userId || !agentId) {
      return errorResponse("userId and agentId query params are required", 400);
    }

    const data = await intelligenceRuntime.intelligenceSdk.listThreads({
      userId,
      agentId,
    });

    return jsonResponse(data);
  } catch (error) {
    logger.error({ err: error }, "Error listing threads");
    return errorResponse(
      error instanceof Error ? error.message : "Failed to list threads",
      500,
    );
  }
}

export async function handleUpdateThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (intelligenceRuntime instanceof Response) {
    return intelligenceRuntime;
  }

  try {
    const body = await request.json();
    const { userId, agentId, ...updates } = body as Record<string, unknown>;

    if (!userId || !agentId) {
      return errorResponse("userId and agentId are required", 400);
    }

    const thread = await intelligenceRuntime.intelligenceSdk.updateThread({
      threadId,
      userId: userId as string,
      agentId: agentId as string,
      updates,
    });

    return jsonResponse(thread);
  } catch (error) {
    logger.error({ err: error, threadId }, "Error updating thread");
    return errorResponse(
      error instanceof Error ? error.message : "Failed to update thread",
      500,
    );
  }
}

export async function handleArchiveThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (intelligenceRuntime instanceof Response) {
    return intelligenceRuntime;
  }

  try {
    const body = await request.json();
    const { userId, agentId } = body as Record<string, unknown>;

    if (!userId || !agentId) {
      return errorResponse("userId and agentId are required", 400);
    }

    await intelligenceRuntime.intelligenceSdk.archiveThread({
      threadId,
      userId: userId as string,
      agentId: agentId as string,
    });

    return jsonResponse({ threadId, archived: true });
  } catch (error) {
    logger.error({ err: error, threadId }, "Error archiving thread");
    return errorResponse(
      error instanceof Error ? error.message : "Failed to archive thread",
      500,
    );
  }
}

export async function handleDeleteThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (intelligenceRuntime instanceof Response) {
    return intelligenceRuntime;
  }

  try {
    const body = await request.json();
    const { userId, agentId } = body as Record<string, unknown>;

    if (!userId || !agentId) {
      return errorResponse("userId and agentId are required", 400);
    }

    await intelligenceRuntime.intelligenceSdk.deleteThread({
      threadId,
      userId: userId as string,
      agentId: agentId as string,
    });

    return jsonResponse({ threadId, deleted: true });
  } catch (error) {
    logger.error({ err: error, threadId }, "Error deleting thread");
    return errorResponse(
      error instanceof Error ? error.message : "Failed to delete thread",
      500,
    );
  }
}
