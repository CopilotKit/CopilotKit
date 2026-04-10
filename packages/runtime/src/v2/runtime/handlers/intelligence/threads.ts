import {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeLike,
  isIntelligenceRuntime,
} from "../../core/runtime";
import { logger } from "@copilotkit/shared";
import { errorResponse, isHandlerResponse } from "../shared/json-response";
import { isValidIdentifier } from "../shared/intelligence-utils";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";

interface ThreadsHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

interface ThreadMutationParams extends ThreadsHandlerParams {
  threadId: string;
}

interface ThreadMutationContext {
  userId: string;
  agentId: string;
  body: Record<string, unknown>;
}

async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch (error) {
    logger.error({ err: error }, "Malformed JSON in request body");
    return errorResponse("Invalid request body", 400);
  }
}

function requireIntelligenceRuntime(
  runtime: CopilotRuntimeLike,
): CopilotIntelligenceRuntimeLike | Response {
  if (!isIntelligenceRuntime(runtime)) {
    return errorResponse(
      "Missing CopilotKitIntelligence configuration. Thread operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
      422,
    );
  }

  return runtime;
}

async function resolveThreadMutationContext(
  runtime: CopilotIntelligenceRuntimeLike,
  request: Request,
): Promise<ThreadMutationContext | Response> {
  const body = await parseJsonBody(request);
  if (isHandlerResponse(body)) return body;

  const user = await resolveIntelligenceUser({ runtime, request });
  if (isHandlerResponse(user)) return user;

  const agentId = body.agentId;
  if (!isValidIdentifier(agentId)) {
    return errorResponse("Valid agentId is required", 400);
  }

  return {
    body,
    userId: user.id,
    agentId,
  };
}

export async function handleListThreads({
  runtime,
  request,
}: ThreadsHandlerParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId");
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const limitParam = url.searchParams.get("limit");
    const cursor = url.searchParams.get("cursor");
    const user = await resolveIntelligenceUser({
      runtime: intelligenceRuntime,
      request,
    });
    if (isHandlerResponse(user)) return user;

    if (!isValidIdentifier(agentId)) {
      return errorResponse("Valid agentId query param is required", 400);
    }

    const data = await intelligenceRuntime.intelligence.listThreads({
      userId: user.id,
      agentId,
      ...(includeArchived ? { includeArchived: true } : {}),
      ...(limitParam ? { limit: Number(limitParam) } : {}),
      ...(cursor ? { cursor } : {}),
    });

    return Response.json(data);
  } catch (error) {
    logger.error({ err: error }, "Error listing threads");
    return errorResponse("Failed to list threads", 500);
  }
}

export async function handleUpdateThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const mutation = await resolveThreadMutationContext(
      intelligenceRuntime,
      request,
    );
    if (isHandlerResponse(mutation)) return mutation;

    const updates = { ...mutation.body };
    delete updates.agentId;
    delete updates.userId;

    const thread = await intelligenceRuntime.intelligence.updateThread({
      threadId,
      userId: mutation.userId,
      agentId: mutation.agentId,
      updates,
    });

    return Response.json(thread);
  } catch (error) {
    logger.error({ err: error, threadId }, "Error updating thread");
    return errorResponse("Failed to update thread", 500);
  }
}

export async function handleSubscribeToThreads({
  runtime,
  request,
}: ThreadsHandlerParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const user = await resolveIntelligenceUser({
      runtime: intelligenceRuntime,
      request,
    });
    if (isHandlerResponse(user)) return user;

    const credentials =
      await intelligenceRuntime.intelligence.ɵsubscribeToThreads({
        userId: user.id,
      });

    return Response.json({ joinToken: credentials.joinToken });
  } catch (error) {
    logger.error({ err: error }, "Error subscribing to threads");
    return errorResponse("Failed to subscribe to threads", 500);
  }
}

export async function handleArchiveThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const mutation = await resolveThreadMutationContext(
      intelligenceRuntime,
      request,
    );
    if (isHandlerResponse(mutation)) return mutation;

    await intelligenceRuntime.intelligence.archiveThread({
      threadId,
      userId: mutation.userId,
      agentId: mutation.agentId,
    });

    return Response.json({ threadId, archived: true });
  } catch (error) {
    logger.error({ err: error, threadId }, "Error archiving thread");
    return errorResponse("Failed to archive thread", 500);
  }
}

export async function handleDeleteThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const mutation = await resolveThreadMutationContext(
      intelligenceRuntime,
      request,
    );
    if (isHandlerResponse(mutation)) return mutation;

    await intelligenceRuntime.intelligence.deleteThread({
      threadId,
      userId: mutation.userId,
      agentId: mutation.agentId,
    });

    return Response.json({ threadId, deleted: true });
  } catch (error) {
    logger.error({ err: error, threadId }, "Error deleting thread");
    return errorResponse("Failed to delete thread", 500);
  }
}

export async function handleGetThreadMessages({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const user = await resolveIntelligenceUser({
      runtime: intelligenceRuntime,
      request,
    });
    if (isHandlerResponse(user)) return user;

    const data = await intelligenceRuntime.intelligence.getThreadMessages({
      threadId,
    });

    return Response.json(data);
  } catch (error) {
    logger.error({ err: error, threadId }, "Error getting thread messages");
    return errorResponse("Failed to get thread messages", 500);
  }
}
