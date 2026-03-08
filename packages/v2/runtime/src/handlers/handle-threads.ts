import { CopilotRuntime } from "../runtime";
import { logger } from "@copilotkitnext/shared";

// -- JSON helpers -----------------------------------------------------------

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function requirePlatform(runtime: CopilotRuntime): Response | null {
  if (!runtime.isIntelligenceMode || !runtime.intelligenceSdk) {
    return errorResponse(
      "Threads are only available in Intelligence mode. Provide intelligenceSdk in CopilotRuntime options.",
      501,
    );
  }
  return null;
}

// -- Shared param types -----------------------------------------------------

interface ThreadsHandlerParams {
  runtime: CopilotRuntime;
  request: Request;
}

interface ThreadMutationParams extends ThreadsHandlerParams {
  threadId: string;
}

// -- GET /threads -----------------------------------------------------------

export async function handleListThreads({
  runtime,
  request,
}: ThreadsHandlerParams): Promise<Response> {
  const notConfigured = requirePlatform(runtime);
  if (notConfigured) return notConfigured;

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const agentId = url.searchParams.get("agentId");

    if (!userId || !agentId) {
      return errorResponse("userId and agentId query params are required", 400);
    }

    const data = await runtime.intelligenceSdk!.listThreads({
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

// -- PATCH /threads/:threadId -----------------------------------------------

export async function handleUpdateThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const notConfigured = requirePlatform(runtime);
  if (notConfigured) return notConfigured;

  try {
    const body = await request.json();
    const { userId, agentId, ...updates } = body as Record<string, unknown>;

    if (!userId || !agentId) {
      return errorResponse("userId and agentId are required", 400);
    }

    const thread = await runtime.intelligenceSdk!.updateThread({
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

// -- POST /threads/:threadId/archive ----------------------------------------

export async function handleArchiveThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const notConfigured = requirePlatform(runtime);
  if (notConfigured) return notConfigured;

  try {
    const body = await request.json();
    const { userId, agentId } = body as Record<string, unknown>;

    if (!userId || !agentId) {
      return errorResponse("userId and agentId are required", 400);
    }

    await runtime.intelligenceSdk!.archiveThread({
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

// -- DELETE /threads/:threadId ----------------------------------------------

export async function handleDeleteThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const notConfigured = requirePlatform(runtime);
  if (notConfigured) return notConfigured;

  try {
    const body = await request.json();
    const { userId, agentId } = body as Record<string, unknown>;

    if (!userId || !agentId) {
      return errorResponse("userId and agentId are required", 400);
    }

    await runtime.intelligenceSdk!.deleteThread({
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
