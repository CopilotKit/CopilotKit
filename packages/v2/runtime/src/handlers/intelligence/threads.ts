import {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeLike,
  isIntelligenceRuntime,
} from "../../runtime";
import { logger } from "@copilotkitnext/shared";
import { errorResponse, jsonResponse } from "../shared/json-response";
import { isValidIdentifier } from "../shared/intelligence-utils";

interface ThreadsHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

interface ThreadMutationParams extends ThreadsHandlerParams {
  threadId: string;
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

    if (!isValidIdentifier(userId) || !isValidIdentifier(agentId)) {
      return errorResponse(
        "Valid userId and agentId query params are required",
        400,
      );
    }

    const data = await intelligenceRuntime.intelligence.listThreads({
      userId,
      agentId,
    });

    return jsonResponse(data);
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
  if (intelligenceRuntime instanceof Response) {
    return intelligenceRuntime;
  }

  try {
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;
    const { userId, agentId, ...updates } = body;

    if (!isValidIdentifier(userId) || !isValidIdentifier(agentId)) {
      return errorResponse("Valid userId and agentId are required", 400);
    }

    const thread = await intelligenceRuntime.intelligence.updateThread({
      threadId,
      userId,
      agentId,
      updates,
    });

    return jsonResponse(thread);
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
  if (intelligenceRuntime instanceof Response) {
    return intelligenceRuntime;
  }

  try {
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;
    const userId = body.userId;

    if (typeof userId !== "string" || userId.length === 0) {
      return errorResponse("userId is required", 400);
    }

    const credentials =
      await intelligenceRuntime.intelligence.subscribeToThreads({
        userId,
      });

    return jsonResponse({ joinToken: credentials.joinToken });
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
  if (intelligenceRuntime instanceof Response) {
    return intelligenceRuntime;
  }

  try {
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;
    const { userId, agentId } = body;

    if (!isValidIdentifier(userId) || !isValidIdentifier(agentId)) {
      return errorResponse("Valid userId and agentId are required", 400);
    }

    await intelligenceRuntime.intelligence.archiveThread({
      threadId,
      userId,
      agentId,
    });

    return jsonResponse({ threadId, archived: true });
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
  if (intelligenceRuntime instanceof Response) {
    return intelligenceRuntime;
  }

  try {
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;
    const { userId, agentId } = body;

    if (!isValidIdentifier(userId) || !isValidIdentifier(agentId)) {
      return errorResponse("Valid userId and agentId are required", 400);
    }

    await intelligenceRuntime.intelligence.deleteThread({
      threadId,
      userId,
      agentId,
    });

    return jsonResponse({ threadId, deleted: true });
  } catch (error) {
    logger.error({ err: error, threadId }, "Error deleting thread");
    return errorResponse("Failed to delete thread", 500);
  }
}
