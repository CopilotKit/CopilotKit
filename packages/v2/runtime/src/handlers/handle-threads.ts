import { CopilotRuntime } from "../runtime";
import { logger } from "@copilotkitnext/shared";

// -- Shared types -----------------------------------------------------------

export interface ThreadSummary {
  id: string;
  name: string;
  lastRunAt: string;
  lastUpdatedAt: string;
}

interface ThreadsHandlerParams {
  runtime: CopilotRuntime;
  request: Request;
}

interface ThreadMutationParams extends ThreadsHandlerParams {
  threadId: string;
}

// -- JSON helpers -----------------------------------------------------------

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// -- GET /threads -----------------------------------------------------------

export async function handleListThreads({
  runtime,
  request,
}: ThreadsHandlerParams): Promise<Response> {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const agentId = url.searchParams.get("agentId");

    if (!userId || !agentId) {
      return errorResponse("userId and agentId query params are required", 400);
    }

    // TODO: call into intelligence platform to list threads
    // const { threads, joinCode } = await runtime.intelligence.listThreads({ userId, agentId });
    const threads: ThreadSummary[] = [];
    const joinCode: string = "";

    return jsonResponse({ threads, joinCode });
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
  try {
    const body = await request.json();
    const { userId, agentId, ...updates } = body as Record<string, unknown>;

    if (!userId || !agentId) {
      return errorResponse("userId and agentId are required", 400);
    }

    // TODO: call into intelligence platform to update thread
    // const thread = await runtime.intelligence.updateThread({ threadId, userId, agentId, ...updates });

    return jsonResponse({ threadId, updated: true });
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
  try {
    const body = await request.json();
    const { userId, agentId } = body as Record<string, unknown>;

    if (!userId || !agentId) {
      return errorResponse("userId and agentId are required", 400);
    }

    // TODO: call into intelligence platform to archive thread
    // await runtime.intelligence.archiveThread({ threadId, userId, agentId });

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
  try {
    const body = await request.json();
    const { userId, agentId } = body as Record<string, unknown>;

    if (!userId || !agentId) {
      return errorResponse("userId and agentId are required", 400);
    }

    // TODO: call into intelligence platform to soft-delete thread
    // await runtime.intelligence.deleteThread({ threadId, userId, agentId });

    return jsonResponse({ threadId, deleted: true });
  } catch (error) {
    logger.error({ err: error, threadId }, "Error deleting thread");
    return errorResponse(
      error instanceof Error ? error.message : "Failed to delete thread",
      500,
    );
  }
}
